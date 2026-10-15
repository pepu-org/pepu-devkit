/**
 * pepu_verify_contract_guide
 *
 * WHAT: Returns the exact, working command to verify a deployed contract's
 * source on pepuscan (PEPU's Blockscout instance), for Foundry and/or
 * Hardhat. This exists because Blockscout verification tooling is
 * notoriously fiddly about flag names across explorer instances/plugin
 * versions, and getting it wrong produces confusing, generic-looking
 * failures that are easy to misattribute to the contract itself rather than
 * the verifier invocation.
 *
 * The Foundry form below (`--verifier blockscout --verifier-url
 * https://pepuscan.com/api`) has been confirmed working directly against
 * pepuscan. The Hardhat form follows Blockscout's own documented
 * `@nomicfoundation/hardhat-verify` integration pattern (customChains for
 * Hardhat 2, the native `verify.blockscout` block for Hardhat 3), adapted
 * with PEPU's own chain id and API URL — it has NOT been independently
 * re-driven against pepuscan in this server's own verification pass, unlike
 * the Foundry command, so treat it as documented-correct rather than
 * live-confirmed and try it on a low-stakes contract first.
 *
 * WHEN TO USE: Right after deploying a contract to PEPU mainnet, before
 * reaching for pepu_verify_contract_status to confirm it worked. Also useful
 * any time a verification attempt is failing with an unclear error and you
 * want to rule out a wrong flag/URL before debugging the source/args
 * themselves.
 */

import { z } from "zod";
import { STATIC_READ } from "../annotations.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertBlockscoutNetwork } from "../blockscout.js";
import { MAINNET } from "../constants.js";
import { jsonResult } from "../format.js";

const inputSchema = {
  tool: z.enum(["foundry", "hardhat", "both"]).default("both").describe("Which toolchain's command to return."),
  network: z
    .enum(["mainnet", "testnet"])
    .default("mainnet")
    .describe('Only "mainnet" is actually verifiable — pepuscan (Blockscout) has no instance for testnet. "testnet" is accepted here only so the tool can explain that clearly instead of a generic schema-validation rejection.'),
  response_format: z
    .enum(["concise", "detailed"])
    .default("concise")
    .describe("concise: just the command(s). detailed: adds the full config snippet (Hardhat), common failure modes, and how to verify a proxy's implementation separately."),
};

function foundryGuide(format: "concise" | "detailed") {
  const out: Record<string, unknown> = {
    confirmedWorking: true,
    command: [
      "forge verify-contract \\",
      "  <deployed_address> \\",
      "  <path/to/Contract.sol>:<ContractName> \\",
      "  --verifier blockscout \\",
      `  --verifier-url ${MAINNET.blockscoutExplorerUrl}/api \\`,
      `  --chain ${MAINNET.chainId} \\`,
      "  --watch",
    ].join("\n"),
    constructorArgsHint: 'If the contract has constructor arguments, append: --constructor-args $(cast abi-encode "constructor(uint256,address)" 1 0xYourArg)',
  };
  if (format === "detailed") {
    out["notes"] = [
      "`--verifier blockscout` (not `--verifier etherscan`, which is forge's default) is the flag that was actually missing in the failure this tool was built to prevent.",
      "The verifier-url MUST include the trailing \"/api\" — pepuscan.com alone will not work.",
      "`--watch` polls until pepuscan reports the verification finished, instead of exiting immediately with an ambiguous \"submitted\" message.",
      "If forge can't auto-detect the compiler version/optimizer settings from your foundry.toml, add --compiler-version and --num-of-optimizations explicitly — mismatched settings are the most common cause of a verification that submits successfully but comes back \"failed\" on pepuscan.",
    ];
  }
  return out;
}

function hardhatGuide(format: "concise" | "detailed") {
  const out: Record<string, unknown> = {
    confirmedWorking: false,
    confirmedWorkingNote: "Follows Blockscout's own documented hardhat-verify integration, adapted with PEPU's values — not independently re-driven against pepuscan in this session. Try it on a low-stakes contract first.",
    command: `npx hardhat verify --network pepu <deployed_address> <constructorArg1> <constructorArg2...>`,
    configSnippetHardhat2: [
      "// hardhat.config.ts (Hardhat 2, @nomicfoundation/hardhat-verify)",
      "networks: {",
      "  pepu: {",
      `    url: "${MAINNET.rpcUrl}",`,
      `    chainId: ${MAINNET.chainId},`,
      "  },",
      "},",
      "etherscan: {",
      '  apiKey: { pepu: "any-non-empty-placeholder" }, // pepuscan does not check this value',
      "  customChains: [",
      "    {",
      '      network: "pepu",',
      `      chainId: ${MAINNET.chainId},`,
      "      urls: {",
      `        apiURL: "${MAINNET.blockscoutExplorerUrl}/api",`,
      `        browserURL: "${MAINNET.blockscoutExplorerUrl}",`,
      "      },",
      "    },",
      "  ],",
      "},",
    ].join("\n"),
  };
  if (format === "detailed") {
    out["configSnippetHardhat3"] = [
      "// hardhat.config.ts (Hardhat 3, native blockscout support)",
      'import hardhatVerify from "@nomicfoundation/hardhat-verify";',
      "",
      "export default {",
      "  plugins: [hardhatVerify],",
      "  verify: {",
      "    blockscout: {",
      `      apiUrl: "${MAINNET.blockscoutExplorerUrl}/api",`,
      "    },",
      "  },",
      "};",
    ].join("\n");
    out["notes"] = [
      'The network name ("pepu" above) is arbitrary — it just has to match between the `networks` entry, `etherscan.apiKey`, `etherscan.customChains[].network`, and the `--network` flag you pass to `hardhat verify`.',
      "Blockscout's own verification API does not check the apiKey value's contents, but hardhat-verify still requires the field to be present and non-empty or it refuses to run.",
      "If `npx hardhat verify` reports the network as unsupported, run `npx hardhat verify --list-networks` to confirm your customChains entry actually registered.",
    ];
  }
  return out;
}

export function registerVerifyContractGuideTool(server: McpServer): void {
  server.registerTool(
    "pepu_verify_contract_guide",
    {
      title: "PEPU contract verification command",
      description:
        "Get the exact command to verify a deployed contract's source on pepuscan (PEPU's Blockscout instance) for Foundry and/or Hardhat, including the specific --verifier/--verifier-url flags Foundry needs (confirmed working) and the customChains/verify.blockscout config Hardhat needs. Call this right after deploying, before pepu_verify_contract_status to check the result — it prevents the confusing generic failures that come from a wrong verifier flag or a missing trailing /api on the URL.",
      inputSchema,
      annotations: STATIC_READ,
    },
    async ({ tool, network, response_format }) => {
      assertBlockscoutNetwork(network);

      const result: Record<string, unknown> = { network };
      if (tool === "foundry" || tool === "both") result["foundry"] = foundryGuide(response_format);
      if (tool === "hardhat" || tool === "both") result["hardhat"] = hardhatGuide(response_format);

      if (response_format === "detailed") {
        result["proxyNote"] =
          "If the deployed contract is a proxy, verifying the proxy address alone typically only registers the proxy's own (often minimal) source. Verify the implementation contract at its own address separately, then pepuscan/Sourcify will usually link the two automatically once both are verified — check the `implementations` field from pepu_verify_contract_status to see if that already happened.";
      }

      return jsonResult(result);
    }
  );
}
