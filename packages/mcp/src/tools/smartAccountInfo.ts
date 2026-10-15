/**
 * pepu_smart_account_info
 *
 * WHAT: Computes the counterfactual address of a ZeroDev Kernel v3 ERC-4337
 * smart account for a given owner (single-ECDSA-owner configuration — the
 * root validator is the Kernel ECDSA Validator deployed on PEPU mainnet at
 * 0x845ADb2C711129d4f3966735eD98a9F09fC4cE57), and reports whether it's
 * actually deployed yet via a live eth_getCode check.
 *
 * The address is NOT computed by re-implementing CREATE2 hashing off-chain
 * (a common source of subtly-wrong smart-account tooling — wrong initcode
 * hash, wrong salt encoding, etc.). Instead this calls the Kernel v3 Account
 * Factory's own on-chain `getAddress(bytes data, bytes32 salt)` view
 * function via RPC — whatever the factory itself says the address will be
 * IS correct by construction, since `createAccount` deploys to exactly that
 * address. Before wiring this up, the factory's behavior was live-verified
 * on PEPU mainnet: `getAddress` returns a different address for a different
 * owner and for a different salt (confirmed by direct calls), so it is
 * genuinely owner/salt-dependent and not, say, ignoring its `data` argument.
 *
 * WHEN TO USE: Before funding or deploying a smart account for a user, to
 * know its address in advance (e.g. to show a deposit address, or to check
 * an existing balance) — or to check whether one was actually deployed
 * already. This tool is READ-ONLY: it never deploys anything and never
 * holds a key. It also does NOT mean gas sponsorship is available — see
 * pepu_known_gotchas: sponsorship is proven working on PEPU mainnet through the
 * hosted bundler and paymaster, but needs a funded project or the free tier;
 * without one, deploying this account needs a normally-funded EOA to pay gas.
 * Only supports the plain single-EOA-owner configuration (no
 * additional modules/hooks) — a Kernel account initialized with a different
 * validator or module set will have a different real address than this
 * tool computes.
 */

import { z } from "zod";
import { REMOTE_READ } from "../annotations.js";
import { encodeFunctionData, encodePacked, isAddress, getAddress as toChecksumAddress, pad, toHex, type Abi } from "viem";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getPublicClient } from "../rpc.js";
import { KERNEL_FACTORY_ADDRESS, KERNEL_ECDSA_VALIDATOR_ADDRESS, KERNEL_CALL_POLICY_ADDRESS, KERNEL_TIMESTAMP_POLICY_ADDRESS, type PepuNetwork } from "../constants.js";
import { jsonResult } from "../format.js";
import { actionableError } from "../errors.js";

const inputSchema = {
  owner: z.string().describe("The EOA address that will control this account (the root ECDSA validator's signer), 0x-prefixed, 40 hex characters."),
  salt: z
    .string()
    .default("0")
    .describe('CREATE2 salt distinguishing multiple accounts for the same owner. Accepts a plain integer string ("0", "1", ...) or a full 0x-prefixed 32-byte value. Defaults to "0" (the address ZeroDev\'s own SDK/UI use by default for a first account).'),
  network: z
    .enum(["mainnet", "testnet"])
    .default("mainnet")
    .describe("Only \"mainnet\" actually works — the Kernel v3 Account Factory is deployed there only. \"testnet\" is accepted here only so the tool can explain that clearly instead of a generic schema-validation rejection."),
  response_format: z
    .enum(["concise", "detailed"])
    .default("concise")
    .describe("concise: the address + deployed status. detailed: adds the raw encoded init data and the configuration assumptions baked into this computation."),
};

const KERNEL_INITIALIZE_ABI = [
  {
    type: "function",
    name: "initialize",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_rootValidator", type: "bytes21" },
      { name: "hook", type: "address" },
      { name: "validatorData", type: "bytes" },
      { name: "hookData", type: "bytes" },
      { name: "initConfig", type: "bytes[]" },
    ],
    outputs: [],
  },
] as const satisfies Abi;

const KERNEL_FACTORY_ABI = [
  {
    type: "function",
    name: "getAddress",
    stateMutability: "view",
    inputs: [
      { name: "data", type: "bytes" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
] as const satisfies Abi;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
/** ERC-7579 validator-type prefix byte used by Kernel v3's packed `bytes21` root-validator identifier (type || address). */
const VALIDATOR_TYPE_PREFIX = 1;

function parseSalt(input: string): `0x${string}` {
  if (/^0x[0-9a-fA-F]{64}$/.test(input)) {
    return input as `0x${string}`;
  }
  try {
    const value = BigInt(input);
    if (value < 0n) throw new Error("negative");
    return pad(toHex(value), { size: 32 });
  } catch {
    actionableError(
      `"${input}" is not a valid salt.`,
      "It must be a non-negative integer string (\"0\", \"1\", ...) or a full 0x-prefixed 32-byte hex value.",
      'Pass "0" if you just want the default first account for this owner.'
    );
  }
}

export function registerSmartAccountInfoTool(server: McpServer): void {
  server.registerTool(
    "pepu_smart_account_info",
    {
      title: "PEPU smart account (ERC-4337) counterfactual address",
      description:
        "Compute the counterfactual address of a ZeroDev Kernel v3 smart account (single-EOA-owner configuration) for a given owner and salt, and check via a live eth_getCode call whether it's already deployed. The address comes directly from the Kernel v3 Account Factory's own on-chain getAddress(bytes,bytes32) view function — not a hand-rolled CREATE2 replica — so it is correct by construction. Mainnet only (the factory isn't deployed on testnet). Read-only: never deploys anything, never holds a key, and does not imply gas sponsorship works (see pepu_known_gotchas) — deploying this account still needs a normally gas-funded transaction today.",
      inputSchema,
      annotations: REMOTE_READ,
    },
    async ({ owner, salt, network, response_format }) => {
      if (!isAddress(owner)) {
        actionableError(`"${owner}" is not a valid EVM address.`, "It must be 0x-prefixed with 40 hex characters.", "Double check the owner address.");
      }
      if (network === "testnet") {
        actionableError(
          "The ZeroDev Kernel v3 Account Factory is not deployed on PEPU testnet (97740).",
          "It (and the rest of the ERC-4337 stack — EntryPoint v0.6/v0.7, the Kernel ECDSA Validator) exists on mainnet (97741) only, deployed by ZeroDev's Conduit Marketplace integration.",
          'Retry with network: "mainnet". Testnet has no smart-account infra at all yet.'
        );
      }

      const saltBytes32 = parseSalt(salt);
      const ownerChecksummed = toChecksumAddress(owner);
      const rootValidator = encodePacked(["uint8", "address"], [VALIDATOR_TYPE_PREFIX, KERNEL_ECDSA_VALIDATOR_ADDRESS as `0x${string}`]);
      const validatorData = encodePacked(["address"], [ownerChecksummed]);
      const initData = encodeFunctionData({
        abi: KERNEL_INITIALIZE_ABI,
        functionName: "initialize",
        args: [rootValidator, ZERO_ADDRESS, validatorData, "0x", []],
      });

      const client = getPublicClient(network as PepuNetwork);
      let counterfactualAddress: `0x${string}`;
      try {
        counterfactualAddress = (await client.readContract({
          address: KERNEL_FACTORY_ADDRESS as `0x${string}`,
          abi: KERNEL_FACTORY_ABI,
          functionName: "getAddress",
          args: [initData, saltBytes32],
        })) as `0x${string}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        actionableError(
          `Calling getAddress on the Kernel v3 Account Factory (${KERNEL_FACTORY_ADDRESS}) failed.`,
          `RPC error: ${message}`,
          "This is unexpected for a well-formed owner address — if this persists, the factory's on-chain behavior may have changed since this tool was last verified."
        );
      }

      const code = await client.getCode({ address: counterfactualAddress });
      const isDeployed = Boolean(code && code !== "0x");

      const result: Record<string, unknown> = {
        owner: ownerChecksummed,
        network,
        salt: saltBytes32,
        factory: KERNEL_FACTORY_ADDRESS,
        rootValidator: "Kernel ECDSA Validator (ZeroDev)",
        rootValidatorAddress: KERNEL_ECDSA_VALIDATOR_ADDRESS,
        counterfactualAddress,
        isDeployed,
        guidance: isDeployed
          ? "This account is already deployed at this address — no need to call createAccount again."
          : "Not deployed yet. Calling this factory's createAccount(data, salt) with the same arguments used here would deploy it to exactly this address — but that requires a signed transaction and gas paid by a funded EOA; this server never signs transactions. Sponsorship is proven working on PEPU mainnet, but the bundler and paymaster policy service are not publicly hosted yet, so sponsored deployment isn't available to apps (see pepu_known_gotchas).",
        assumption: "Single-EOA-owner Kernel v3 account: root validator = the ECDSA validator above, no hook, no extra ERC-7579 modules. A Kernel account initialized with a different validator/module configuration for the same owner will have a DIFFERENT real address than this.",
      };

      if (response_format === "detailed") {
        result["initData"] = initData;
        result["sessionKeyPolicyModules"] = { callPolicyV004: KERNEL_CALL_POLICY_ADDRESS, timestampPolicy: KERNEL_TIMESTAMP_POLICY_ADDRESS, note: "On-chain session keys (@pepu-chain/sdk/session/kernel) use these modules; see pepu_session_policy." };
        result["rootValidatorPacked"] = rootValidator;
      }

      return jsonResult(result);
    }
  );
}
