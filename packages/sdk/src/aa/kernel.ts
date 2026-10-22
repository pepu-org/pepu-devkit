/**
 * @pepu-chain/sdk/aa/kernel: Kernel v3.1 smart account plus sponsored-send
 * helpers for the "direct" transport (your own bundler and paymaster URLs).
 * Needs the optional peers `@zerodev/sdk` and `@zerodev/ecdsa-validator`.
 *
 * This is the only module in the SDK (with `session/kernel` and `combo`) that
 * imports ZeroDev. Ported from `templates/sponsored-session-app/lib/kernel.ts`
 * (Kernel v3.1 build, 20% fee headroom because Alto lacks
 * `zd_getUserOperationGasPrice`).
 *
 * Session keys: `toPepuKernelAccount` takes an optional `plugins.regular`
 * validator, which is the plug point WP-B6 (`/session/kernel`, `/combo`) uses
 * to add a permission validator on top of the ECDSA root.
 */
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { constants, createKernelAccount, createKernelAccountClient } from "@zerodev/sdk";
import type { Signer } from "@zerodev/sdk/types";
import { createPublicClient, http } from "viem";
import type { Address, Hex, LocalAccount, PublicClient, WalletClient } from "viem";

import { pepuMainnet } from "../chains.js";
import { resolvePepuEndpoints } from "../endpoints.js";
import { txUrl } from "../explorer.js";
import type { PaymasterContext } from "../erc7677.js";
import { normalizeCalls } from "./calls.js";
import { ENTRY_POINT_V07, createPepuPaymasterClient, estimatePepuUserOpFees, requireBundlerUrl } from "./clients.js";
import { describeUserOpFailure } from "./describe.js";
import type { Call } from "./types.js";

export type { Call } from "./types.js";
export { encodeKernelExecute } from "./calls.js";

/** Kernel v3.1, the version deployed on PEPU mainnet (factory in the contract registry). */
export const KERNEL_VERSION = constants.KERNEL_V3_1;

type ZeroDevClient = Parameters<typeof createKernelAccount>[0];
type KernelAccountParams = Parameters<typeof createKernelAccount>[1];

/**
 * The ZeroDev packages resolve their own copy of viem as a peer. In a monorepo
 * with several viem installs two identical `PublicClient` types are nominally
 * different; this is a type-level bridge only (same object at runtime).
 */
function zd(client: PublicClient): ZeroDevClient {
  return client as unknown as ZeroDevClient;
}

/** The Kernel account type this module builds. */
export type KernelSmartAccount = Awaited<ReturnType<typeof createKernelAccount>>;
/** The sponsored client type {@link createPepuSponsoredClient} returns. */
export type KernelAccountClient = ReturnType<typeof createKernelAccountClient>;

/** Anything that can sign for the Kernel owner. */
export type KernelOwner = LocalAccount | Signer | WalletClient;

function defaultPublicClient(): PublicClient {
  return createPublicClient({ chain: pepuMainnet, transport: http(resolvePepuEndpoints().rpcUrl) }) as PublicClient;
}

/**
 * Build a Kernel v3.1 smart account owned by `owner` (ECDSA root validator).
 * The address depends only on the owner and `index`, never on a session.
 * Pass `plugins.regular` to add a permission (session-key) validator on top
 * of the root; that is how `@pepu-chain/sdk/session/kernel` builds on this.
 *
 * @example
 * const account = await toPepuKernelAccount({ publicClient, owner: privateKeyToAccount(key) });
 */
export async function toPepuKernelAccount(p: {
  publicClient: PublicClient;
  owner: KernelOwner;
  index?: bigint;
  /**
   * `regular` is a ZeroDev validator plugin, for example the permission
   * validator from `@zerodev/permissions` (see `@pepu-chain/sdk/session/kernel`).
   * Typed as `object` so this entry does not need `@zerodev/permissions` types.
   */
  plugins?: { regular?: object };
}): Promise<KernelSmartAccount> {
  const sudo = await signerToEcdsaValidator(zd(p.publicClient), {
    signer: p.owner as Signer,
    entryPoint: ENTRY_POINT_V07,
    kernelVersion: KERNEL_VERSION,
  });
  return createKernelAccount(zd(p.publicClient), {
    entryPoint: ENTRY_POINT_V07,
    kernelVersion: KERNEL_VERSION,
    plugins: { sudo, ...(p.plugins?.regular ? { regular: p.plugins.regular } : {}) },
    ...(p.index !== undefined ? { index: p.index } : {}),
  } as KernelAccountParams);
}

function toEmptyAccount(address: Address): LocalAccount {
  const refuse = async (): Promise<never> => {
    throw new Error("read-only account cannot sign");
  };
  return {
    address,
    type: "local",
    source: "custom",
    publicKey: "0x" as Hex,
    signMessage: refuse,
    signTransaction: refuse,
    signTypedData: refuse,
  } as unknown as LocalAccount;
}

/**
 * The counterfactual Kernel address for an owner, with no signature needed.
 * Lifted from `templates/sponsored-session-app/lib/kernel.ts`.
 *
 * @example
 * const smartAccount = await getKernelAddress(publicClient, ownerAddress);
 */
export async function getKernelAddress(publicClient: PublicClient, owner: Address): Promise<Address> {
  const account = await toPepuKernelAccount({ publicClient, owner: toEmptyAccount(owner) });
  return account.address;
}

/**
 * A Kernel client that sends through YOUR bundler and has gas paid by YOUR
 * paymaster (ERC-7677). Fees come from the chain with 20% headroom.
 *
 * @example
 * const client = createPepuSponsoredClient({ account, paymasterContext: { privyAccessToken } });
 */
export function createPepuSponsoredClient(p: {
  account: KernelSmartAccount;
  bundlerUrl?: string;
  paymasterUrl?: string;
  /** Project client token; builds the ERC-7677 URL against the paymaster base when no URL is configured. */
  paymasterToken?: string;
  paymasterContext?: PaymasterContext;
  publicClient?: PublicClient;
}): KernelAccountClient {
  const publicClient = p.publicClient ?? defaultPublicClient();
  const paymaster = createPepuPaymasterClient({
    ...(p.paymasterUrl !== undefined ? { paymasterUrl: p.paymasterUrl } : {}),
    ...(p.paymasterToken !== undefined ? { paymasterToken: p.paymasterToken } : {}),
    ...(p.paymasterContext ? { context: p.paymasterContext } : {}),
  });
  return createKernelAccountClient({
    account: p.account,
    chain: pepuMainnet,
    client: zd(publicClient),
    bundlerTransport: http(requireBundlerUrl(p.bundlerUrl)),
    paymaster,
    userOperation: { estimateFeesPerGas: async () => estimatePepuUserOpFees(publicClient) },
  } as unknown as Parameters<typeof createKernelAccountClient>[0]);
}

/** Result of {@link sendSponsored}. */
export interface SendSponsoredResult {
  userOpHash: Hex;
  transactionHash: Hex;
  success: boolean;
  paymaster: Address | null;
  actualGasCostWei: bigint;
  explorerUrl: string;
}

/**
 * Encode `calls`, send one UserOperation, wait for its receipt, and report
 * who paid. Failures are mapped through `describeUserOpFailure` (AAxx and
 * paymaster reasons become typed PepuErrors). Flow ported from
 * `sendSessionTap` in the sponsored-session-app template.
 *
 * @example
 * const r = await sendSponsored({ client, calls: [{ to, abi, functionName: "tap" }] });
 * console.log(r.paymaster, r.explorerUrl);
 */
export async function sendSponsored(p: {
  client: KernelAccountClient;
  calls: Call[];
  timeoutMs?: number;
}): Promise<SendSponsoredResult> {
  const calls = normalizeCalls(p.calls);
  try {
    const account = p.client.account;
    if (!account) throw new Error("The Kernel client has no account.");
    const callData = await account.encodeCalls(calls);
    const userOpHash = await p.client.sendUserOperation({ callData });
    const receipt = await p.client.waitForUserOperationReceipt({ hash: userOpHash, timeout: p.timeoutMs ?? 90_000 });
    const transactionHash = receipt.receipt.transactionHash;
    return {
      userOpHash,
      transactionHash,
      success: receipt.success,
      paymaster: receipt.paymaster ?? null,
      actualGasCostWei: receipt.actualGasCost,
      explorerUrl: txUrl(pepuMainnet, transactionHash),
    };
  } catch (e) {
    throw describeUserOpFailure(e);
  }
}
