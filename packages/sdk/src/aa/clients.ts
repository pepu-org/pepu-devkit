import { createPublicClient, http } from "viem";
import type { PublicClient } from "viem";
import { createBundlerClient, createPaymasterClient } from "viem/account-abstraction";
import type { BundlerClient, PaymasterClient, SmartAccount } from "viem/account-abstraction";

import { pepuMainnet } from "../chains.js";
import { PEPU_ENV, resolvePepuEndpoints } from "../endpoints.js";
import { PepuConfigError } from "../errors.js";
import type { PaymasterContext } from "../erc7677.js";
import { buildErc7677Url } from "../paymaster/api.js";

/** EntryPoint v0.7, the only version PEPU's bundler and paymaster speak. */
export const ENTRY_POINT_V07 = {
  address: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  version: "0.7",
} as const;

/** Fee headroom numerator/denominator: 12/10 = +20%. */
const FEE_HEADROOM_NUM = 12n;
const FEE_HEADROOM_DEN = 10n;

/**
 * The Alto-compatible fee estimator: the chain's own `estimateFeesPerGas`,
 * with `maxFeePerGas` x 1.2. Alto does not implement ZeroDev's
 * `zd_getUserOperationGasPrice`, so the default estimator would fail.
 * Ported from `templates/sponsored-session-app/lib/kernel.ts`.
 *
 * @example
 * const fees = await estimatePepuUserOpFees(publicClient);
 */
export async function estimatePepuUserOpFees(
  publicClient: Pick<PublicClient, "estimateFeesPerGas">,
): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const fees = await publicClient.estimateFeesPerGas();
  return {
    maxFeePerGas: (fees.maxFeePerGas * FEE_HEADROOM_NUM) / FEE_HEADROOM_DEN,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  };
}

/** Resolve the bundler URL or throw `CONFIG_MISSING_ENV` naming the variable. */
export function requireBundlerUrl(explicit?: string): string {
  const { bundlerUrl } = resolvePepuEndpoints(explicit === undefined ? {} : { bundlerUrl: explicit });
  if (bundlerUrl === null) {
    throw new PepuConfigError("CONFIG_MISSING_ENV", `No bundler URL. Set ${PEPU_ENV.bundlerUrl} or pass bundlerUrl.`, {
      hint: "The hosted PEPU bundler is the default; if it was cleared, set PEPU_BUNDLER_URL to https://bundler.pepeunchained.com or your own bundler.",
    });
  }
  return bundlerUrl;
}

/**
 * Resolve the complete ERC-7677 paymaster URL or throw `CONFIG_MISSING_ENV`.
 * Order: `explicit` URL, then `PEPU_PAYMASTER_URL`, then `token` (a project client token, built against the
 * paymaster base: the hosted service unless a custom URL is configured). The hosted paymaster has no tokenless
 * ERC-7677 URL, because the token names the project (or free-tier app) that is billed.
 */
export function requirePaymasterUrl(explicit?: string, token?: string): string {
  const { paymasterUrl, paymasterBaseUrl } = resolvePepuEndpoints(explicit === undefined ? {} : { paymasterUrl: explicit });
  if (paymasterUrl !== null) return paymasterUrl;
  if (token !== undefined && token.trim() !== "" && paymasterBaseUrl !== null) {
    return buildErc7677Url({ baseUrl: paymasterBaseUrl, token });
  }
  throw new PepuConfigError("CONFIG_MISSING_ENV", `No ERC-7677 paymaster URL. Set ${PEPU_ENV.paymasterUrl} or pass paymasterUrl / paymasterToken.`, {
    hint: "The hosted paymaster (https://paymaster.pepeunchained.com) needs your project's client token: set PEPU_PAYMASTER_URL to https://paymaster.pepeunchained.com/v2/paymaster/<client token>.",
  });
}

/**
 * An ERC-7677 paymaster client for PEPU (viem `createPaymasterClient`), using
 * the endpoints registry for the URL. A `context` (for example
 * `buildPaymasterContext({ privyAccessToken })`) is injected into every
 * `pm_getPaymasterStubData` and `pm_getPaymasterData` call unless the caller
 * passes one.
 *
 * @example
 * const paymaster = createPepuPaymasterClient({
 *   context: buildPaymasterContext({ privyAccessToken }),
 * });
 */
export function createPepuPaymasterClient(
  o: { paymasterUrl?: string; paymasterToken?: string; context?: PaymasterContext } = {},
): PaymasterClient {
  const client = createPaymasterClient({ transport: http(requirePaymasterUrl(o.paymasterUrl, o.paymasterToken)) });
  const ctx = o.context;
  if (!ctx) return client;
  return {
    ...client,
    getPaymasterData: (p) => client.getPaymasterData({ ...p, context: p.context ?? ctx }),
    getPaymasterStubData: (p) => client.getPaymasterStubData({ ...p, context: p.context ?? ctx }),
  };
}

/**
 * A viem bundler client for PEPU's bundler, with the fee estimator
 * pre-wired ({@link estimatePepuUserOpFees}).
 *
 * @example
 * const bundler = createPepuBundlerClient({ account, paymaster: createPepuPaymasterClient() });
 * const hash = await bundler.sendUserOperation({ calls: [{ to, data }] });
 */
export function createPepuBundlerClient(o: {
  bundlerUrl?: string;
  account: SmartAccount;
  paymaster?: PaymasterClient;
  paymasterContext?: PaymasterContext;
  publicClient?: PublicClient;
}): BundlerClient {
  const rpcUrl = resolvePepuEndpoints().rpcUrl;
  const publicClient = o.publicClient ?? createPublicClient({ chain: pepuMainnet, transport: http(rpcUrl) });
  return createBundlerClient({
    account: o.account,
    chain: pepuMainnet,
    client: publicClient,
    transport: http(requireBundlerUrl(o.bundlerUrl)),
    ...(o.paymaster ? { paymaster: o.paymaster } : {}),
    ...(o.paymasterContext ? { paymasterContext: o.paymasterContext } : {}),
    userOperation: { estimateFeesPerGas: async () => estimatePepuUserOpFees(publicClient) },
  }) as BundlerClient;
}
