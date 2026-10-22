/**
 * pepu_session_policy
 *
 * WHAT: Builds a scoped session policy for a contract and function list, in
 * either of the SDK's two session modes, and returns it with a consent
 * summary, the selector list, the trust notice, and a ready-to-paste
 * SDK snippet.
 *
 *  - mode "privy":  `buildSessionPolicy` + `describeSessionScope` from
 *    @pepu-chain/sdk/session. Off-chain Privy policy, EOA, the user pays gas.
 *  - mode "kernel": `describeKernelSessionScope` + `buildKernelSessionPolicies`
 *    from @pepu-chain/sdk/session/kernel. On-chain call and timestamp
 *    policies on a Kernel account; composes with sponsorship.
 *
 * Pure: nothing is sent, signed or stored.
 */

import { z } from "zod";
import { toFunctionSelector, toFunctionSignature, isAddress, type AbiFunction, type Address } from "viem";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SESSION_TRUST_NOTICE, buildSessionPolicy, describeSessionScope, resolveSessionMinutes, sessionExpiry } from "@pepu-chain/sdk/session";
import { STATIC_READ } from "../annotations.js";
import { parseFunctionInput, type FunctionInput } from "../abi-input.js";
import { actionableError } from "../errors.js";
import { jsonResult } from "../format.js";
import { sdkCall } from "../sdk-helpers.js";

const inputSchema = {
  mode: z.enum(["privy", "kernel"]).describe("privy: off-chain Privy policy on the embedded EOA (user pays gas). kernel: on-chain call and timestamp policies on a Kernel smart account (composes with sponsorship)."),
  contract: z.string().describe("The one contract the session may call, 0x address."),
  functions: z
    .array(z.union([z.string(), z.record(z.string(), z.unknown())]))
    .min(1)
    .describe("Functions the session may call: Solidity signatures like 'tap()' or 'transfer(address to, uint256 amount)', or JSON ABI function fragments. At least one."),
  minutes: z.number().positive().optional().describe("Session length in minutes. Default 15, clamped to 1..1440."),
  valueLimitWei: z.string().regex(/^\d+$/).optional().describe("Kernel mode only: the max native value per call in wei (default 0). The Privy mode always requires zero value."),
};

interface KernelModule {
  buildKernelSessionPolicies(p: { calls: readonly { target: Address; abi: readonly unknown[]; functionName: string; valueLimit?: bigint }[]; validUntil: number; validAfter?: number }): unknown[];
  describeKernelSessionScope(p: { calls: readonly { target: Address; abi: readonly unknown[]; functionName: string; valueLimit?: bigint }[]; validUntil: number; validAfter?: number }): {
    calls: { target: Address; functionName: string; signature: string; selector: string; maxValueWei: string }[];
    validAfter: number;
    validUntil: number;
  };
}

async function loadKernel(): Promise<KernelModule | null> {
  try {
    return (await import("@pepu-chain/sdk/session/kernel")) as unknown as KernelModule;
  } catch {
    return null;
  }
}

function snippetFor(mode: "privy" | "kernel", contract: string, fns: AbiFunction[], minutes: number): string {
  const frags = JSON.stringify(fns, null, 2);
  if (mode === "privy") {
    return [
      'import { createSessionRoutes } from "@pepu-chain/sdk/session/server";',
      "",
      `const functions = ${frags} as const;`,
      "",
      "const routes = createSessionRoutes({",
      `  scope: { contractAddress: "${contract}", functions },`,
      `  minutes: ${minutes},`,
      "});",
      "// app/api/session/grant/route.ts   -> export const { POST } = routes.grant;",
      "// app/api/session/status/route.ts  -> export const { GET } = routes.status;",
      "// app/api/session/revoke/route.ts  -> export const { POST } = routes.revoke;",
    ].join("\n");
  }
  return [
    'import { createSponsoredSessionRoutes, createMemoryStore } from "@pepu-chain/sdk/combo";',
    "",
    `const abi = ${frags} as const;`,
    "",
    "export const routes = createSponsoredSessionRoutes({",
    `  scope: { calls: [${fns.map((f) => `{ target: "${contract}", abi, functionName: "${f.name}" }`).join(", ")}] },`,
    `  minutes: ${minutes},`,
    "  store: createMemoryStore(), // DEV ONLY: use a persistent store with the key encrypted at rest",
    "  act: { parse: () => ({}), buildCalls: () => [/* the calls to sponsor */] },",
    "});",
  ].join("\n");
}

export function registerSessionPolicyTool(server: McpServer): void {
  server.registerTool(
    "pepu_session_policy",
    {
      title: "Build a PEPU session policy",
      description:
        "Build a scoped session policy for one contract and a list of functions. mode 'privy' uses buildSessionPolicy and describeSessionScope from @pepu-chain/sdk/session (off-chain Privy policy, user pays gas, value always zero). mode 'kernel' uses buildKernelSessionPolicies and describeKernelSessionScope from @pepu-chain/sdk/session/kernel (on-chain call and timestamp policies on a Kernel account, composes with sponsorship). Returns the policy, a consent summary, selectors, the trust notice (SESSION_TRUST_NOTICE) and a paste-ready snippet. Pure: nothing is signed or sent.",
      inputSchema,
      annotations: STATIC_READ,
    },
    async ({ mode, contract, functions, minutes, valueLimitWei }) => {
      if (!isAddress(contract, { strict: false })) {
        actionableError(`"${contract}" is not a valid contract address.`, "It must be 0x-prefixed with 40 hex characters.", "Pass the contract the session may call.");
      }
      const target = contract as Address;
      const fns = functions.map((f, i) => parseFunctionInput(f as FunctionInput, `functions[${i}]`));
      const mins = resolveSessionMinutes(minutes);
      const expiry = sessionExpiry(Math.floor(Date.now() / 1000), mins);
      const valueLimit = valueLimitWei !== undefined ? BigInt(valueLimitWei) : 0n;

      if (mode === "privy") {
        if (valueLimit !== 0n) {
          actionableError("valueLimitWei is not supported in privy mode.", "The Privy policy always requires value to be exactly zero.", "Use mode 'kernel' for a per-call value limit, or drop valueLimitWei.");
        }
        const policy = await sdkCall("buildSessionPolicy", () => buildSessionPolicy({ contractAddress: target, functions: fns, expiresAtUnixSeconds: expiry }));
        const scope = await sdkCall("describeSessionScope", () => describeSessionScope({ contractAddress: target, functions: fns, expiresAtUnixSeconds: expiry }));
        return jsonResult({
          mode,
          enforcedBy: "Privy's backend policy engine (off-chain). The user still pays gas; gas is not capped by the policy.",
          expiresAtUnixSeconds: expiry,
          minutes: mins,
          policy,
          consent: {
            summary: `Allow this app to call ${scope.functions.map((f) => f.signature).join(", ")} on ${target}, with zero value, for ${mins} minutes.`,
            functions: scope.functions,
          },
          selectors: scope.functions.map((f) => ({ signature: f.signature, selector: f.selector })),
          trustNotice: SESSION_TRUST_NOTICE["privy-offchain"],
          snippet: snippetFor("privy", target, fns, mins),
          sdkFunctions: "buildSessionPolicy, describeSessionScope (@pepu-chain/sdk/session)",
        });
      }

      const calls = fns.map((fn) => ({ target, abi: [fn] as const, functionName: fn.name, valueLimit }));
      const kernel = await loadKernel();
      let scope;
      let policyCount: number | null = null;
      let loadedKernel = false;
      if (kernel) {
        loadedKernel = true;
        scope = await sdkCall("describeKernelSessionScope", () => kernel.describeKernelSessionScope({ calls, validUntil: expiry }));
        const policies = await sdkCall("buildKernelSessionPolicies", () => kernel.buildKernelSessionPolicies({ calls, validUntil: expiry }));
        policyCount = policies.length;
      } else {
        // TODO(sdk): the pure scope description lives behind the @zerodev/* imports of /session/kernel. When the optional
        // ZeroDev peers are not installed, derive the same data with viem so the tool still answers. Split the pure helpers in the SDK.
        scope = {
          calls: fns.map((fn) => ({
            target,
            functionName: fn.name,
            signature: toFunctionSignature(fn).replace(/^function /, ""),
            selector: toFunctionSelector(fn),
            maxValueWei: valueLimit.toString(),
          })),
          validAfter: 0,
          validUntil: expiry,
        };
      }
      return jsonResult({
        mode,
        enforcedBy: "On-chain: your Kernel account's permission validator (ZeroDev call policy v0.0.4 plus the timestamp policy). Holds even if the app backend is compromised.",
        expiresAtUnixSeconds: expiry,
        minutes: mins,
        scope,
        policiesBuilt: loadedKernel ? { count: policyCount, kinds: ["call policy v0.0.4", "timestamp policy"] } : false,
        ...(loadedKernel ? {} : { warning: "@zerodev/sdk, @zerodev/permissions and @zerodev/ecdsa-validator are not installed here, so only the scope was described. Install them to also build the policy objects." }),
        consent: {
          summary: `Allow this app to call ${scope.calls.map((c) => c.signature).join(", ")} on ${target}, up to ${valueLimit.toString()} wei per call, until ${new Date(expiry * 1000).toISOString()}. Enforced on-chain.`,
        },
        selectors: scope.calls.map((c) => ({ signature: c.signature, selector: c.selector })),
        trustNotice: SESSION_TRUST_NOTICE["kernel-onchain"],
        gasNote: "With sponsorship, the paymaster reserves about 20.5 PEPU for a session's first operation and about 6.9 PEPU for later ones: set spend caps above that.",
        snippet: snippetFor("kernel", target, fns, mins),
        sdkFunctions: "describeKernelSessionScope, buildKernelSessionPolicies (@pepu-chain/sdk/session/kernel)",
      });
    }
  );
}
