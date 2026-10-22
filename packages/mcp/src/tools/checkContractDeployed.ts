/**
 * pepu_check_contract_deployed
 *
 * WHAT: Given an address OR a well-known name ("Multicall3", "Permit2",
 * "EntryPoint v0.7", "Kernel Factory", "WPEPU", "TapScore", etc.), reports
 * whether it actually has live bytecode on the requested network right now
 * (a real eth_getCode call, not just the cached fact), and — critically —
 * if you asked about a canonical address that has no code on PEPU but a
 * working PEPU-specific replacement exists (Multicall3 is the textbook
 * case), surfaces that replacement address prominently instead of just
 * saying "not deployed" and leaving you to guess why.
 *
 * WHEN TO USE: This prevents the single most common mistake on this chain —
 * assuming a canonical infra address (especially Multicall3) works here
 * unchanged. Call this before hardcoding ANY "well-known" contract address
 * into PEPU config, or when a call to an address you expected to have code
 * is reverting with no data. For a static, no-network-call summary of every
 * known contract at once, use pepu_known_gotchas or pepu_chain_info
 * (detailed) instead — this tool's value is the live, right-now check.
 *
 * Example calls:
 *   { query: "Multicall3" }
 *   { query: "0xcA11bde05977b3631167028862bE2a173976CA11" }  (canonical Multicall3 — will report "no code, use 0x9CE1..." )
 *   { query: "EntryPoint", network: "testnet" }
 */

import { z } from "zod";
import { REMOTE_READ } from "../annotations.js";
import { isAddress, getAddress as toChecksumAddress } from "viem";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CANONICAL_CONTRACTS, type CanonicalContractStatus, type PepuNetwork } from "../constants.js";
import { getPublicClient } from "../rpc.js";
import { jsonResult } from "../format.js";
import { actionableError } from "../errors.js";

const inputSchema = {
  query: z.string().min(1).describe('An address (0x-prefixed, 40 hex chars) OR a well-known contract/token name, e.g. "Multicall3", "Permit2", "EntryPoint v0.7", "Kernel Factory", "WPEPU", "TapScore". Partial/case-insensitive names are matched, e.g. "multicall" or "entrypoint".'),
  network: z.enum(["mainnet", "testnet"]).default("mainnet").describe("RPC-direct check — works on both networks."),
  response_format: z
    .enum(["concise", "detailed"])
    .default("concise")
    .describe("concise: deployed yes/no + the address to actually use. detailed: adds the full explanatory note and, for a name query, every matching known contract's live status."),
};

/** Small alias table so common alternate phrasings resolve without requiring the exact display name. */
const NAME_ALIASES: Record<string, string> = {
  multicall: "Multicall3",
  multicall3: "Multicall3",
  permit2: "Permit2",
  "entry point": "EntryPoint",
  entrypoint: "EntryPoint",
  "kernel factory": "Kernel v3 Account Factory (ZeroDev)",
  "account factory": "Kernel v3 Account Factory (ZeroDev)",
  metafactory: "Kernel MetaFactory (ZeroDev)",
  "meta factory": "Kernel MetaFactory (ZeroDev)",
  "ecdsa validator": "Kernel ECDSA Validator (ZeroDev)",
  validator: "Kernel ECDSA Validator (ZeroDev)",
  create2: "CREATE2 deterministic deployer",
  deployer: "CREATE2 deterministic deployer",
  wpepu: "WPEPU (Wrapped PEPU)",
  "wrapped pepu": "WPEPU (Wrapped PEPU)",
  "wrapped native": "WPEPU (Wrapped PEPU)",
  tapscore: "TapScore (demo contract)",
  demo: "TapScore (demo contract)",
};

function findMatches(query: string): CanonicalContractStatus[] {
  const normalized = query.trim().toLowerCase();
  // An alias resolves to a SUBSTRING to search for (e.g. "entrypoint" -> "EntryPoint",
  // which should still match both "EntryPoint v0.6" and "EntryPoint v0.7") — not a full
  // display name to compare for exact equality.
  const searchTerm = (NAME_ALIASES[normalized] ?? query.trim()).toLowerCase();
  return CANONICAL_CONTRACTS.filter((c) => {
    const name = c.name.toLowerCase();
    return name.includes(searchTerm) || searchTerm.includes(name) || name.includes(normalized);
  });
}

async function liveCheck(address: string, network: PepuNetwork): Promise<boolean> {
  const client = getPublicClient(network);
  const code = await client.getCode({ address: address as `0x${string}` });
  return Boolean(code && code !== "0x");
}

async function describeKnownContract(
  known: CanonicalContractStatus,
  network: PepuNetwork,
  format: "concise" | "detailed"
): Promise<Record<string, unknown>> {
  const addressToCheck = known.pepuAddress ?? known.canonicalAddress;
  const hasCode = await liveCheck(addressToCheck, network);
  const cachedExpectation = network === "mainnet" ? known.deployed : known.deployedOnTestnet;

  const out: Record<string, unknown> = {
    name: known.name,
    network,
    useThisAddress: addressToCheck,
    hasBytecodeRightNow: hasCode,
    category: known.category,
  };
  if (known.pepuAddress) {
    out["canonicalAddress"] = known.canonicalAddress;
    out["canonicalAddressHasCode"] = network === "mainnet" ? await liveCheck(known.canonicalAddress, network) : null;
  }
  if (hasCode !== cachedExpectation) {
    out["staleWarning"] = `This server's cached fact said deployed=${cachedExpectation} for ${network}, but a live check just returned ${hasCode}. Trusting the live result — if you're seeing this, the underlying deployment situation changed since this server's constants.ts was last verified.`;
  }
  if (format === "detailed") {
    out["note"] = known.note;
  }
  return out;
}

export function registerCheckContractDeployedTool(server: McpServer): void {
  server.registerTool(
    "pepu_check_contract_deployed",
    {
      title: "PEPU check if a contract is actually deployed",
      description:
        "Check, with a real live on-chain call, whether a well-known contract (by name — 'Multicall3', 'Permit2', 'EntryPoint v0.7', 'Kernel Factory', 'WPEPU', 'TapScore', etc. — or by address) is actually deployed on PEPU mainnet or testnet, and get the PEPU-specific address to use when it differs from the canonical one. This is the single most effective guardrail against the most common PEPU integration bug: assuming Multicall3 (or another 'every chain has this' contract) exists at its usual address here. Prefer this over hardcoding an address from memory or from docs written for other chains.",
      inputSchema,
      annotations: REMOTE_READ,
    },
    async ({ query, network, response_format }) => {
      const trimmed = query.trim();

      if (isAddress(trimmed)) {
        const checksummed = toChecksumAddress(trimmed);
        const hasCode = await liveCheck(checksummed, network);
        const knownMatch = CANONICAL_CONTRACTS.find(
          (c) => c.canonicalAddress.toLowerCase() === checksummed.toLowerCase() || c.pepuAddress?.toLowerCase() === checksummed.toLowerCase()
        );

        const result: Record<string, unknown> = {
          query: checksummed,
          network,
          hasBytecodeRightNow: hasCode,
        };

        if (knownMatch) {
          const isCanonicalSlot = knownMatch.canonicalAddress.toLowerCase() === checksummed.toLowerCase();
          if (isCanonicalSlot && knownMatch.pepuAddress && !hasCode) {
            result["guidance"] = `This IS the canonical address for ${knownMatch.name}, but it has no code on PEPU. ${knownMatch.name} is still available here — use ${knownMatch.pepuAddress} instead.`;
            result["useThisAddressInstead"] = knownMatch.pepuAddress;
          } else {
            result["matchedKnownContract"] = knownMatch.name;
            result["guidance"] = hasCode
              ? `This is ${knownMatch.name}'s working address on ${network} — confirmed live.`
              : `This address matches ${knownMatch.name} in this server's records, but currently has no bytecode on ${network}.`;
          }
          if (response_format === "detailed") result["note"] = knownMatch.note;
        } else {
          result["guidance"] = hasCode
            ? "Has bytecode. Not one of this server's known named contracts — that's fine, most contracts aren't."
            : `No bytecode found on ${network}. Either it hasn't been deployed, you're on the wrong network, or you have the wrong address.`;
        }

        return jsonResult(result);
      }

      const matches = findMatches(trimmed);
      if (matches.length === 0) {
        actionableError(
          `"${query}" doesn't match a valid address or a known contract name.`,
          `Known names include: ${CANONICAL_CONTRACTS.map((c) => c.name).join(", ")}.`,
          "Pass one of those names (partial match is fine, e.g. \"multicall\"), or a full 0x-prefixed address to check directly."
        );
      }

      const described = await Promise.all(matches.map((m) => describeKnownContract(m, network, response_format)));
      return jsonResult({
        query: trimmed,
        network,
        matchCount: described.length,
        matches: described,
      });
    }
  );
}

// Re-exported for tests.
export { findMatches };
