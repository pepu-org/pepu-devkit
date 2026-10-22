/**
 * Static, hand-verified facts about Pepe Unchained (PEPU) V2.
 *
 * Every value here was checked directly against a live RPC call or a live
 * pepuscan.com API response on 2026-09-18 (see packages/mcp/README.md for the
 * verification log). This file is the single source of truth the tools read
 * from for anything that isn't a live lookup — do not hand-edit an address
 * here without re-verifying it the same way.
 *
 * IMPORTANT DISAMBIGUATION: "Pepe Unchained" has two unrelated chains sharing
 * a brand. This server only ever talks about V2 (chain id 97741 / testnet
 * 97740, Arbitrum Orbit). V1 (chain id 3409, OP Stack, migrated away from in
 * 2025) is out of scope and should never be confused with these values.
 */

import { getContract, getPepuAddresses, isDeployed, pepuMainnet, pepuTestnet, pepuTokenList, type PepuContractName } from "@pepu-chain/sdk";

/**
 * Registry-backed address lookup. Every address in this file comes from the
 * SDK contract registry (`getContract` from @pepu-chain/sdk); this file keeps
 * only MCP-specific prose (notes, gotchas). Throws at import time if the
 * registry has no deployed entry, which would be an SDK bug.
 */
function registryAddress(key: PepuContractName): string {
  const entry = getContract(pepuMainnet.id, key);
  if (!isDeployed(entry)) {
    throw new Error(`@pepu-chain/sdk registry has no deployed mainnet entry for "${key}"`);
  }
  return entry.address;
}

function tokenAddress(symbol: string): string {
  const token = pepuTokenList.tokens.find((t) => t.chainId === pepuMainnet.id && t.symbol === symbol);
  if (!token) throw new Error(`@pepu-chain/sdk token list has no mainnet token "${symbol}"`);
  return token.address;
}

export type PepuNetwork = "mainnet" | "testnet";

export interface CanonicalContractStatus {
  /** Human name of the contract/standard. */
  name: string;
  /** The address this contract has on every other chain that deploys it via CREATE2/keyless deployment. */
  canonicalAddress: string;
  /** Whether that canonical address has live bytecode on PEPU. */
  deployed: boolean;
  /**
   * Set when a working deployment exists on PEPU at a DIFFERENT address
   * than the canonical one. An agent must use this address rather than
   * `canonicalAddress`, which has no code.
   */
  pepuAddress?: string;
  /** Extra guidance for an agent about what to do given the status. */
  note: string;
  /**
   * "infra" = account-abstraction/deployment-tooling primitive (factories,
   * EntryPoint, Multicall, Permit2). "token" = an ERC-20 with chain-wide
   * significance (currently only the wrapped-native token). "demo" = a
   * small verified example contract kept around for testing tools like
   * pepu_read_contract, not something a real integration depends on.
   * Defaults to "infra" semantics when read by older code that doesn't
   * check this field.
   */
  category: "infra" | "token" | "demo";
  /** True if bytecode has been confirmed present at `pepuAddress ?? canonicalAddress` on testnet (97740), not just mainnet. */
  deployedOnTestnet: boolean;
}

export interface NetworkInfo {
  network: PepuNetwork;
  chainId: number;
  chainIdHex: string;
  name: string;
  rpcUrl: string;
  /** Alternative RPC providers confirmed live, beyond the primary Conduit one. */
  alternativeRpcUrls: string[];
  /** The Blockscout-backed explorer, if one is known to be registered for this network. `null` when none is confirmed. */
  blockscoutExplorerUrl: string | null,
  /** The Conduit-default explorer. Present on both networks but NOT Blockscout-backed (no indexer). */
  conduitExplorerUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  arbOsVersion: number;
  arbOsName: string;
  settlesTo: string;
  daMode: string;
  eip7702Live: boolean;
  p256PrecompileLive: boolean;
  /** Wei per gas at time of verification. Included so tools can sanity-check live values against a known baseline. */
  referenceBaseFeePerGasWei: string;
  create2DeployerAddress: string;
  create2DeployerDeployed: boolean;
}

export const MAINNET: NetworkInfo = {
  network: "mainnet",
  chainId: pepuMainnet.id,
  chainIdHex: `0x${pepuMainnet.id.toString(16)}`,
  name: "Pepe Unchained V2 Mainnet",
  rpcUrl: pepuMainnet.rpcUrls.default.http[0],
  alternativeRpcUrls: ["https://97741.rpc.thirdweb.com"],
  blockscoutExplorerUrl: pepuMainnet.blockExplorers.default.url,
  conduitExplorerUrl: "https://explorer-pepu-v2-mainnet-0.t.conduit.xyz",
  nativeCurrency: { name: "Pepe Unchained", symbol: "PEPU", decimals: 18 },
  arbOsVersion: 51,
  arbOsName: "Dia",
  settlesTo: "Ethereum L1",
  daMode:
    "AnyTrust / Optimium, 1-of-1 Data Availability Committee (not a full rollup). " +
    "V2 (97741) has no independent L2BEAT assessment or third-party risk rating. " +
    "Note: L2BEAT's 'Pepe Unchained' page describes the ARCHIVED V1 chain (3409, OP Stack) " +
    "and its ratings/findings do not apply to this chain.",
  eip7702Live: true,
  p256PrecompileLive: true,
  referenceBaseFeePerGasWei: "12500000000000",
  create2DeployerAddress: registryAddress("create2Factory"),
  create2DeployerDeployed: true,
};

export const TESTNET: NetworkInfo = {
  network: "testnet",
  chainId: pepuTestnet.id,
  chainIdHex: `0x${pepuTestnet.id.toString(16)}`,
  name: "Pepe Unchained V2 Testnet",
  rpcUrl: pepuTestnet.rpcUrls.default.http[0],
  alternativeRpcUrls: [],
  // Confirmed 2026-09-18 against chains.blockscout.com/api/chains: no entry for chain id 97740.
  // The testnet's own explorer is the Conduit default UI, NOT Blockscout — no indexer, no REST/GraphQL API.
  blockscoutExplorerUrl: null,
  conduitExplorerUrl: "https://explorer-pepu-v2-testnet-vn4qxxp9og.t.conduit.xyz",
  nativeCurrency: { name: "Pepe Unchained", symbol: "PEPU", decimals: 18 },
  arbOsVersion: 51,
  arbOsName: "Dia",
  settlesTo: "Ethereum L1",
  daMode: "AnyTrust / Optimium, mirrors mainnet configuration",
  eip7702Live: true,
  p256PrecompileLive: true,
  referenceBaseFeePerGasWei: "12500000000000",
  create2DeployerAddress: registryAddress("create2Factory"),
  create2DeployerDeployed: true,
};

export function getNetworkInfo(network: PepuNetwork): NetworkInfo {
  return network === "mainnet" ? MAINNET : TESTNET;
}

/**
 * Canonical infra contracts and their actual deployment status on PEPU.
 * Same list applies to both mainnet and testnet — both were verified empty
 * at the canonical addresses (verified against the live chain).
 */
export const CANONICAL_CONTRACTS: CanonicalContractStatus[] = [
  {
    name: "Multicall3",
    canonicalAddress: "0xcA11bde05977b3631167028862bE2a173976CA11",
    deployed: false,
    pepuAddress: registryAddress("multicall3"),
    note:
      "AVAILABLE ON PEPU, but NOT at the canonical address — use pepuAddress (0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd, mainnet 97741 only). The canonical address is structurally unreachable here: its original pre-signed deployment tx carries a hardcoded 1,000,000 gas limit and Nitro needs roughly 14.3M gas for the same bytecode. A full Multicall3 (canonical mds1/multicall3 source, solc 0.8.12, optimizer 10,000,000 runs) was deployed via the CREATE2 deterministic deployer and verified on pepuscan; viem's multicall is confirmed working against it. Configure viem/wagmi with contracts.multicall3.address set to pepuAddress, or use @pepu-chain/sdk's pepuMainnet chain object which already does. Separately: PepuSwap uses its own unrelated multicall at 0x927af2a6B76d2d8206d93004463F8C122701383B — that is NOT Multicall3, it is a different, smaller contract.",
    category: "infra",
    deployedOnTestnet: false,
  },
  {
    name: "Permit2",
    canonicalAddress: registryAddress("permit2"),
    deployed: true,
    note:
      "Deployed at the canonical address on MAINNET (97741) — confirmed live via a DOMAIN_SEPARATOR() call returning a real, non-zero bytes32 (0xa66551d353be8e08a749568a5c2084ebd52fd7ae05f364c657bc2e54b549baca). It was deployed permissionlessly via the standard CREATE2 route (the deterministic deployer is live) some time after this server's initial verification pass — if you have older PEPU documentation/notes claiming Permit2 doesn't exist here, they are stale. NOT deployed on testnet (97740). PepuSwap uses its own separate, non-canonical Permit2 at 0xB461c05f76d7f919FF7A3Df2B0D2593F56538b4B — do not confuse the two; canonical-Permit2-aware tooling (e.g. Uniswap's Permit2 SDK) should target the canonical address above, not PepuSwap's.",
    category: "infra",
    deployedOnTestnet: false,
  },
  {
    name: "EntryPoint v0.6",
    canonicalAddress: registryAddress("entryPoint06"),
    deployed: true,
    note: "Deployed at the canonical address on MAINNET (97741) only, by ZeroDev's Conduit Marketplace integration. NOT on testnet (97740). Prefer v0.7 for new work.",
    category: "infra",
    deployedOnTestnet: false,
  },
  {
    name: "EntryPoint v0.7",
    canonicalAddress: registryAddress("entryPoint07"),
    deployed: true,
    note: "Deployed at the canonical address on MAINNET (97741) only, by ZeroDev's Conduit Marketplace integration; getNonce/balanceOf confirmed responding. NOT on testnet (97740). Smart accounts are therefore possible. NOTE: a deployed EntryPoint alone does NOT give you gas sponsorship — that additionally requires a bundler and a funded paymaster. Both are hosted by PEPU (bundler https://bundler.pepeunchained.com, paymaster service https://paymaster.pepeunchained.com), and the paymaster is the v2 PepuSponsoredPaymasterV7.",
    category: "infra",
    deployedOnTestnet: false,
  },
  {
    name: "Kernel v3 Account Factory (ZeroDev)",
    canonicalAddress: registryAddress("kernelFactory"),
    deployed: true,
    note: "Deployed on MAINNET (97741) only, alongside the Kernel MetaFactory (0xd703aaE79538628d27099B8c4f621bE4CCd142d5) and ECDSA validator (0x845ADb2C711129d4f3966735eD98a9F09fC4cE57). Confirmed live on-chain: its bytecode exposes exactly the three selectors ZeroDev's KernelFactory ABI defines (createAccount(bytes,bytes32), getAddress(bytes,bytes32), implementation()), and implementation() resolves to the Kernel v3.1 account logic contract (initialize(bytes21,address,bytes,bytes,bytes[]) selector 0x3c3b752b is present in its bytecode). Use these for ERC-4337 smart accounts on PEPU — see pepu_smart_account_info, which computes counterfactual addresses against this exact factory.",
    category: "infra",
    deployedOnTestnet: false,
  },
  {
    name: "Kernel MetaFactory (ZeroDev)",
    canonicalAddress: registryAddress("kernelMetaFactory"),
    deployed: true,
    note: "Deployed on MAINNET (97741) only. Whitelists which underlying factory (e.g. the Kernel v3 Account Factory above) is allowed to be called through it; most integrations can call the Kernel factory directly and never need this address, but ZeroDev's own SDK routes through it by default.",
    category: "infra",
    deployedOnTestnet: false,
  },
  {
    name: "Kernel ECDSA Validator (ZeroDev)",
    canonicalAddress: registryAddress("ecdsaValidator"),
    deployed: true,
    note: "Deployed on MAINNET (97741) only. Confirmed on-chain as a standard ERC-7579 validator module (onInstall(bytes)/isInitialized(address)/isModuleType(uint256) selectors all present). This is the default root validator for a simple single-EOA-owner Kernel account — see pepu_smart_account_info.",
    category: "infra",
    deployedOnTestnet: false,
  },
  {
    name: "CREATE2 deterministic deployer",
    canonicalAddress: registryAddress("create2Factory"),
    deployed: true,
    note: "Live. This is what made permissionless canonical-address deployment of Permit2 and both EntryPoint versions possible on PEPU (all three now deployed on mainnet using it) — the same route remains open for any other CREATE2/keyless-deployed canonical contract that still lacks code here.",
    category: "infra",
    deployedOnTestnet: true,
  },
  {
    name: "WPEPU (Wrapped PEPU)",
    canonicalAddress: tokenAddress("WPEPU"),
    deployed: true,
    note: 'The canonical wrapped-native ERC-20 for this chain (symbol/name confirmed live via .symbol() -> "WPEPU", .name() -> "Wrapped PEPU"). Native PEPU itself is NOT an ERC-20 and has no other wrapper — DEX/router code that needs an ERC-20 handle for the native currency should use this address. A contract also exists at the SAME address on testnet, but it is a different, older (pre-0.5 Solidity, WETH9-style) bytecode than the mainnet one — do not assume identical behavior, gas cost, or ABI between the two; testnet also has no Blockscout to verify either one\'s source.',
    category: "token",
    deployedOnTestnet: true,
  },
  {
    name: "Sponsored Paymaster v2 (PepuSponsoredPaymasterV7)",
    canonicalAddress: registryAddress("paymaster"),
    deployed: true,
    note: "Deployed on MAINNET (97741) only (block about 10537341) — this project's own tiered ERC-4337 paymaster, not a canonical or ZeroDev address. The free pool was seeded with 300 PEPU. Owner 0x5966dFaB11c8AEe767e0739083417D02f4a634A1, manager 0x063Ab6C16c38D19A4bC76E7c39A4A0A73afCaBb0. It sponsors through the hosted policy service (https://paymaster.pepeunchained.com) and bundler (https://bundler.pepeunchained.com). Free tier per Privy user: 100 PEPU/day and 50 PEPU/hour, free-tier targets TapScore only for now. Beyond that a dApp claims and deposits into its own project. Deposits are one-way.",
    category: "infra",
    deployedOnTestnet: false,
  },
  {
    name: "Verifying Paymaster v1 (PepuVerifyingPaymasterV7) - RETIRED",
    canonicalAddress: registryAddress("paymasterV1"),
    deployed: true,
    note: "RETIRED. The first paymaster; its EntryPoint deposit was withdrawn (deposit is 0), so it cannot sponsor anything. The contract still has bytecode. Do not deposit to it or route new work to it; use the v2 paymaster.",
    category: "infra",
    deployedOnTestnet: false,
  },
  {
    name: "TapScore (demo contract)",
    canonicalAddress: registryAddress("tapScore"),
    deployed: true,
    note: "A tiny verified example contract (solc v0.8.24) with tap() (increments msg.sender's score) and scores(address) view returns (uint256). Useful as a known-good target to test pepu_read_contract or pepu_get_transaction against — not something a real integration should depend on. Mainnet only.",
    category: "demo",
    deployedOnTestnet: false,
  },
  {
    name: "Kernel v3.1 Implementation (ZeroDev)",
    canonicalAddress: registryAddress("kernelImplementation"),
    deployed: true,
    note:
      "Deployed on MAINNET (97741) only by ZeroDev's Conduit Marketplace integration. The Kernel v3.1 implementation that the Kernel factory resolves to; every Kernel account proxies to it.",
    category: "infra",
    deployedOnTestnet: false,
  },
  {
    name: "Kernel ECDSA Signer module (ZeroDev)",
    canonicalAddress: registryAddress("kernelEcdsaSignerModule"),
    deployed: true,
    note:
      "Deployed on MAINNET (97741) only. The signer module used by permission-validator session keys (the on-chain session mode in @pepu-chain/sdk/session/kernel).",
    category: "infra",
    deployedOnTestnet: false,
  },
  {
    name: "ZeroDev Call Policy v0.0.4",
    canonicalAddress: registryAddress("kernelCallPolicyV004"),
    deployed: true,
    note:
      "Deployed on MAINNET (97741) only. Scopes a Kernel session key to specific targets and function selectors. Pinned to v0.0.4: v0.0.5 is NOT deployed on PEPU.",
    category: "infra",
    deployedOnTestnet: false,
  },
  {
    name: "ZeroDev Timestamp Policy",
    canonicalAddress: registryAddress("kernelTimestampPolicy"),
    deployed: true,
    note:
      "Deployed on MAINNET (97741) only. Bounds a Kernel session key to a validity window (validAfter to validUntil).",
    category: "infra",
    deployedOnTestnet: false,
  },
];

/**
 * Registry entries that exist as names but have no address yet (for example
 * entries that are pending on testnet). Read from the SDK registry so a future
 * deployment flips here with no MCP edit. Never invent an address for these.
 */
export function listPendingMainnetContracts(): { key: string; name: string; reason: string }[] {
  return getPepuAddresses(pepuMainnet.id)
    .filter((row) => row.status === "pending")
    .map((row) => ({ key: row.key, name: row.name, reason: row.note }));
}


/** Convenience named exports for tool code that needs one specific address rather than searching CANONICAL_CONTRACTS by name. Kept in sync with the entries above — verified the same way (see README "Verification log"). */
export const WPEPU_ADDRESS = tokenAddress("WPEPU");
export const TAPSCORE_ADDRESS = registryAddress("tapScore");
export const KERNEL_FACTORY_ADDRESS = registryAddress("kernelFactory");
export const KERNEL_METAFACTORY_ADDRESS = registryAddress("kernelMetaFactory");
export const KERNEL_ECDSA_VALIDATOR_ADDRESS = registryAddress("ecdsaValidator");
export const ENTRYPOINT_V06_ADDRESS = registryAddress("entryPoint06");
export const ENTRYPOINT_V07_ADDRESS = registryAddress("entryPoint07");
export const PAYMASTER_ADDRESS = registryAddress("paymaster");
export const KERNEL_CALL_POLICY_ADDRESS = registryAddress("kernelCallPolicyV004");
export const KERNEL_TIMESTAMP_POLICY_ADDRESS = registryAddress("kernelTimestampPolicy");

/** High-signal gotchas an agent building on PEPU should know before writing any code. */
export const KNOWN_GOTCHAS: string[] = [
  "Multicall3 IS available on mainnet, but at the PEPU-specific address 0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd — NOT the canonical 0xcA11bde0... address, which has no code and cannot ever have any on this chain. Set contracts.multicall3.address explicitly (or use @pepu-chain/sdk's pepuMainnet, which already does). Never rely on the library default.",
  "PepuSwap (the chain's main DEX) uses non-canonical Multicall and Permit2 addresses. Do not confuse those with the canonical Multicall3/Permit2 addresses used elsewhere.",
  "There are two block explorers. pepuscan.com is the real Blockscout instance with a working indexer/REST/GraphQL API — use it. The Conduit-default explorer (explorer-pepu-v2-*-*.t.conduit.xyz) self-reports hasIndexer:false and has no address history or token analytics.",
  "pepuscan.com (Blockscout) only covers MAINNET (97741). No Blockscout instance is registered for testnet (97740) as of 2026-09-18 — Blockscout-backed tools (address overview, transaction decode, contract verification, search) only work for mainnet. Testnet users are limited to direct RPC calls.",
  "The public Conduit RPC is rate-limited (-32017) and gates debug_/trace_ methods behind an authenticated API key (-32401). A real app needs a Conduit API key.",
  "baseFeePerGas is unusually high in gwei terms (~12,500 gwei) because PEPU (the fee-denominating token) has a very low USD unit price — this is expected, not a misconfiguration. Do not flag it as an error.",
  "ERC-4337 EntryPoint v0.6/v0.7, the ZeroDev Kernel factory and the v2 paymaster (0xdb28528C9399C33c9A0297E8A62F39145acbC30D) ARE deployed on mainnet (97741), and PEPU HOSTS THE BUNDLER (https://bundler.pepeunchained.com) AND PAYMASTER SERVICE (https://paymaster.pepeunchained.com). Gas sponsorship works through those hosted URLs with a project token. The v1 paymaster (0x2B6F...) is RETIRED with a zero deposit. The ERC-7677 URL is https://paymaster.pepeunchained.com/v2/paymaster/<token> and always embeds a token: a project CLIENT token (ppt_) works only from the project's allowed origins (with none set it is refused with project_origin_not_allowed), server code uses the project SERVER key (ppk_), and the free tier needs a verified Privy access token from PEPU's own Privy app in the ERC-7677 context (100 PEPU/day and 50 PEPU/hour per user, TapScore targets only for now). Other dApps claim a project, deposit and use its token. Deposits are one-way, so nobody can withdraw them.",
  "Two-address model: with sponsorship, a user has an embedded EOA (the signer) and a Kernel smart account, which is a DIFFERENT address and the one that actually transacts and shows up on pepuscan. Never tell a user to send funds to one expecting them at the other.",
  "Privy session signers: Privy's server-side eth_sendTransaction rejects chain 97741 (Unsupported chain with id 97741) because PEPU is not one of Privy's 'Tier 3' chains. The supported pattern is eth_signTransaction (policy attached to that method) and broadcasting the signed transaction yourself through PEPU's RPC.",
  "Privy setup: Allowed origins must include the exact origin with port (http://localhost:3000; http://localhost without a port does not match, and Next.js silently falls back to port 3001 when 3000 is taken, which breaks login). 'Automatically create embedded wallets on login' should be on in the dashboard. Coinbase smart wallet does not support chain 97741, so set eoaOnly. Privy's own pre-flight gas estimate is conservative at PEPU's ~12,500 gwei base fee and can refuse a transfer the wallet can afford. The 'Unable to fetch token price' console error is harmless.",
  "There are two unrelated chains named 'Pepe Unchained': V1 (chain id 3409, OP Stack, legacy/migrated) and V2 (chain id 97741, Arbitrum Orbit, this chain). Never mix data between them.",
  "WPEPU exists at the same address (0xF9Cf4A16d26979b929Be7176bAc4e7084975FCB8) on BOTH mainnet and testnet, but they are two different deployments with different (and differently-old) bytecode. Don't assume testnet WPEPU behaves identically to mainnet WPEPU just because the address matches — and remember testnet has no Blockscout to verify either one's source against.",
  "The public Conduit RPC does not expose debug_traceCall or eth_simulateV1 (they're gated behind an authenticated Conduit API key URL, .../<API_KEY>). A revert from the public RPC therefore often arrives as just a 4-byte selector with no readable reason string — use pepu_decode_error on it rather than assuming the call gave you nothing useful, and don't expect full trace-level debugging without your own API key.",
  "SELF-HOSTING THE SPONSORSHIP STACK: Alto 0.0.21 needs safe-mode false (with safe-mode true, eth_sendUserOperation returns HTTP 500 for every operation while gas estimation still works) and enable-cors true (the browser calls the bundler directly; put it behind a filtering proxy in production). Privy's SDK calls pm_getPaymasterData more than once per operation, so the policy service is idempotent by userOpHash. pm_getPaymasterStubData is unauthenticated by ERC-7677's design; the real gate is pm_getPaymasterData, and a paymaster denial's real reason is in the JSON-RPC error's data.reason.",
  "PRIVY POLICY NAME LIMIT: Privy policy and rule names must be at most 49 characters. The live validator rejects 50 or more ('must be fewer than 50 characters') even though Privy's published OpenAPI says maxLength 50. A name built from a contract address or duration can silently cross it, and the failure is a 400 at policy creation. @pepu-chain/sdk/server's buildSessionPolicy enforces it.",
  "SESSION SIGNER TRANSACTIONS DENIED: check in order (1) the policy rule method is eth_signTransaction and to/function/value match, (2) the session has expired, (3) a policy or rule name over 49 characters (fails at creation, so no signer is attached), (4) key quorum mismatch: NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID must be the registered quorum and PRIVY_AUTHORIZATION_KEY its private key (symptom: 401 'No valid authorization keys or user signing keys available'). A denial is a failed transaction, not proof the session is gone. Revoke with removeSigners from useSigners.",
  "WALLET PROVISIONING AND ACTIVE WALLET: the Privy Dashboard's 'create embedded wallets on login' setting wins over createOnLogin in code. If Privy's own 'Creating your wallet' modal hangs, set createOnLogin 'off' and create the wallet server-side (POST /api/wallet/ensure using PRIVY_APP_SECRET, owner user_id, gated on getEmbeddedConnectedWallet(wallets), not wallets.length). Also pin the embedded wallet as wagmi's active account with useSetActiveWallet from @privy-io/wagmi, or an installed browser extension (MetaMask, Phantom) can become the active account and receive the app's balance reads and sends.",
  "SCOPE DECISIONS: the Telegram Mini App template is excluded because Telegram restricts Mini Apps to TON, and Global Wallet (a cross-app wallet) is deferred. Do not offer or promise either.",
];

/** Standard ERC-20 `symbol()`/`decimals()`/`balanceOf` fragment, used by pepu_read_contract examples and pepu_get_address_overview. */
export const ERC20_ABI_FRAGMENT = [
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;
