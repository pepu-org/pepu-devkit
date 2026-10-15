/**
 * pepu_verify_contract_status
 *
 * WHAT: Checks whether an address is verified on pepuscan (Blockscout), and
 * if so returns its ABI and verification metadata (compiler, language,
 * proxy type, Sourcify link). Distinguishes "not a contract at all" from
 * "contract but unverified" — pepuscan's own API returns an identical 404
 * for both, which is exactly the kind of ambiguity an agent shouldn't have
 * to untangle itself.
 *
 * WHEN TO USE: Before calling pepu_read_contract, when you don't already
 * know a contract's ABI. Also useful before deploying/verifying your own
 * contract, to check whether an existing one at a given address is already
 * verified. Mainnet only. Full source code text is deliberately NOT
 * returned (it can be very large and low-signal for a tool call) — use the
 * returned sourcifyRepoUrl to fetch it directly if you need the full source.
 */

import { z } from "zod";
import { REMOTE_READ } from "../annotations.js";
import { isAddress, getAddress as toChecksumAddress } from "viem";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertBlockscoutNetwork, getAddress, getSmartContract } from "../blockscout.js";
import { jsonResult } from "../format.js";
import { actionableError } from "../errors.js";

const inputSchema = {
  address: z.string().describe("A 0x-prefixed contract address, 40 hex characters."),
  network: z
    .enum(["mainnet", "testnet"])
    .default("mainnet")
    .describe('Only "mainnet" actually works — pepuscan/Blockscout does not index testnet. "testnet" is accepted here only so the tool can explain that clearly instead of a generic schema-validation rejection.'),
  response_format: z
    .enum(["concise", "detailed"])
    .default("concise")
    .describe("concise: verified yes/no, name, compiler. detailed: adds the full ABI, license, proxy/implementation info, and Sourcify link."),
};

export function registerVerifyContractStatusTool(server: McpServer): void {
  server.registerTool(
    "pepu_verify_contract_status",
    {
      title: "PEPU contract verification status",
      description:
        "Check whether a PEPU (mainnet) address is a verified contract on pepuscan, and if so get its ABI, compiler version, and Sourcify link. Use this before pepu_read_contract if you don't already have the ABI, or to confirm your own contract verified successfully after a deploy. Correctly distinguishes an unverified contract from an address that isn't a contract at all, which pepuscan's raw API does not.",
      inputSchema,
      annotations: REMOTE_READ,
    },
    async ({ address, network, response_format }) => {
      if (!isAddress(address)) {
        actionableError(`"${address}" is not a valid EVM address.`, "It must be 0x-prefixed with 40 hex characters.", "Double check the address.");
      }
      assertBlockscoutNetwork(network);

      const checksummed = toChecksumAddress(address);
      const contract = await getSmartContract(checksummed);

      if (contract) {
        const result: Record<string, unknown> = {
          address: checksummed,
          isContract: true,
          isVerified: contract.is_verified,
          name: contract.name,
          compilerVersion: contract.compiler_version,
          language: contract.language,
          proxyType: contract.proxy_type,
        };
        if (response_format === "detailed") {
          result["abi"] = contract.abi;
          result["licenseType"] = contract.license_type;
          result["optimizationEnabled"] = contract.optimization_enabled;
          result["optimizationRuns"] = contract.optimization_runs;
          result["verifiedAt"] = contract.verified_at;
          result["isFullyVerified"] = contract.is_fully_verified;
          result["isVerifiedViaSourcify"] = contract.is_verified_via_sourcify;
          result["sourcifyRepoUrl"] = contract.sourcify_repo_url;
          result["implementations"] = contract.implementations;
        } else if (contract.abi) {
          result["abiFunctionCount"] = contract.abi.filter((i: { type?: string }) => i.type === "function").length;
          result["guidance"] = "Call again with response_format: \"detailed\" to get the full ABI array for use with pepu_read_contract.";
        }
        return jsonResult(result);
      }

      // pepuscan returns an identical 404 whether the address is an
      // unverified contract or not a contract at all — disambiguate.
      const addr = await getAddress(checksummed);
      if (!addr) {
        actionableError(
          `${checksummed} has no on-chain history on PEPU mainnet.`,
          "It's neither a known contract nor an address pepuscan has ever seen a balance or transaction for.",
          "Confirm the address is correct."
        );
      }

      return jsonResult({
        address: checksummed,
        isContract: addr.is_contract,
        isVerified: false,
        guidance: addr.is_contract
          ? "This IS a contract but it has no verified source on pepuscan. You will need its ABI from another source (e.g. its deployment repo, or a bytecode-matching tool) before using pepu_read_contract on it."
          : "This is an externally-owned account (EOA), not a contract — there is nothing to verify.",
      });
    }
  );
}
