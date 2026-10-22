/**
 * Thin client for pepuscan.com's Blockscout REST API (v2).
 *
 * pepuscan.com is a real, publicly-registered Blockscout instance for PEPU
 * mainnet (confirmed against https://chains.blockscout.com/api/chains, key
 * "97741"). There is NO registered Blockscout instance for testnet (97740) —
 * that chain's only explorer is Conduit's default, non-indexed UI. Every
 * function here therefore only ever talks to mainnet; callers must check
 * `assertBlockscoutNetwork` first for any tool that accepts a `network` param.
 *
 * This file intentionally exposes only the handful of endpoints the PEPU
 * tools actually compose (address, counters, token balances, transaction,
 * smart contract, search) — it is not a general Blockscout API client.
 */

import { actionableError } from "./errors.js";
import type { PepuNetwork } from "./constants.js";

export const BLOCKSCOUT_BASE = "https://pepuscan.com/api/v2";

/** Minimum spacing between outbound calls to pepuscan, so a chatty agent loop can't hammer a public API. */
const MIN_INTERVAL_MS = 300;
let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_INTERVAL_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

/**
 * Throws an actionable error if the caller asked for testnet data from a
 * Blockscout-backed tool. Call this before doing any pepuscan lookup.
 */
export function assertBlockscoutNetwork(network: PepuNetwork): void {
  if (network === "testnet") {
    actionableError(
      "pepuscan.com (Blockscout) only indexes PEPU mainnet (chain 97741).",
      "There is no registered Blockscout instance for testnet (chain 97740) as of the last verification — its only explorer is Conduit's default UI, which self-reports no indexer (no address history, no token analytics, no verification API).",
      "Retry with network: \"mainnet\", or for testnet use pepu_read_contract / pepu_estimate_gas_cost, which talk to the RPC directly and work on both networks."
    );
  }
}

interface BlockscoutErrorBody {
  message?: string;
  errors?: Array<{ detail?: string; title?: string }>;
}

async function blockscoutFetch<T>(path: string): Promise<T> {
  await throttle();
  let res: Response;
  try {
    res = await fetch(`${BLOCKSCOUT_BASE}${path}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    actionableError(
      `Could not reach pepuscan.com's API.`,
      `Network error: ${err instanceof Error ? err.message : String(err)}.`,
      "Check connectivity and retry; if this persists, pepuscan.com itself may be down."
    );
  }

  if (res.status === 404) {
    return null as T;
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as BlockscoutErrorBody;
      detail = body.message ?? body.errors?.map((e) => e.detail ?? e.title).filter(Boolean).join("; ") ?? detail;
    } catch {
      // body wasn't JSON; keep statusText
    }
    actionableError(
      `pepuscan.com returned HTTP ${res.status} for ${path}.`,
      `Detail: ${detail}.`,
      res.status === 422
        ? "This usually means the address/hash is malformed — double-check it is a valid 0x-prefixed, checksummed 40-hex-char address or 64-hex-char hash."
        : "Re-check the input value and retry."
    );
  }

  return res.json() as Promise<T>;
}

export interface BlockscoutAddressToken {
  address_hash: string;
  name: string | null;
  symbol: string | null;
  decimals: string | null;
  type: string;
  holders_count: string | null;
  total_supply: string | null;
}

export interface BlockscoutAddress {
  hash: string;
  is_contract: boolean;
  is_verified: boolean | null;
  is_scam: boolean;
  name: string | null;
  coin_balance: string | null;
  creator_address_hash: string | null;
  creation_transaction_hash: string | null;
  proxy_type: string | null;
  implementations: Array<{ address: string; name: string | null }>;
  token: BlockscoutAddressToken | null;
  has_tokens: boolean;
  has_token_transfers: boolean;
}

export interface BlockscoutAddressCounters {
  transactions_count: string;
  token_transfers_count: string;
  gas_usage_count: string;
  validations_count: string;
}

export interface BlockscoutTokenBalance {
  token: BlockscoutAddressToken;
  token_id: string | null;
  value: string;
}

export interface BlockscoutDecodedInputParam {
  name: string;
  type: string;
  value: unknown;
}

export interface BlockscoutDecodedInput {
  method_call: string;
  method_id: string;
  parameters: BlockscoutDecodedInputParam[];
}

export interface BlockscoutTransaction {
  hash: string;
  status: "ok" | "error" | null;
  result: string;
  block_number: number | null;
  timestamp: string | null;
  from: { hash: string; name: string | null; is_contract: boolean };
  to: { hash: string; name: string | null; is_contract: boolean } | null;
  created_contract: { hash: string } | null;
  value: string;
  fee: { type: string; value: string };
  gas_used: string | null;
  gas_limit: string;
  gas_price: string;
  method: string | null;
  decoded_input: BlockscoutDecodedInput | null;
  revert_reason: string | null;
  nonce: number;
  transaction_types: string[];
  arbitrum?: {
    batch_number: number | null;
    batch_data_container: string | null;
    status: string | null;
  };
}

export interface BlockscoutSmartContract {
  name: string | null;
  is_verified: boolean;
  is_fully_verified: boolean;
  is_verified_via_sourcify: boolean;
  is_verified_via_verifier_alliance: boolean;
  compiler_version: string | null;
  optimization_enabled: boolean | null;
  optimization_runs: number | null;
  language: string | null;
  license_type: string | null;
  proxy_type: string | null;
  implementations: Array<{ address: string; name: string | null }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  abi: any[] | null;
  verified_at: string | null;
  sourcify_repo_url: string | null;
}

export interface BlockscoutSearchItem {
  type: string; // "token" | "address" | "transaction" | "block" | ...
  address_hash?: string;
  hash?: string;
  transaction_hash?: string;
  block_hash?: string;
  name?: string | null;
  symbol?: string | null;
  is_smart_contract_address?: boolean;
  is_smart_contract_verified?: boolean;
  url?: string;
  address_url?: string;
  token_url?: string;
}

export interface BlockscoutSearchResult {
  items: BlockscoutSearchItem[];
  next_page_params: unknown;
}

export interface BlockscoutToken {
  address_hash: string;
  name: string | null;
  symbol: string | null;
  decimals: string | null;
  type: string;
  total_supply: string | null;
  holders_count: string | null;
  exchange_rate: string | null;
  circulating_market_cap: string | null;
  icon_url: string | null;
  /** Blockscout's own scam/spam heuristic verdict, e.g. "ok". Not a financial or security guarantee — surface it, don't over-trust it. */
  reputation: string | null;
}

export interface BlockscoutStats {
  total_blocks: string;
  total_transactions: string;
  total_addresses: string;
  gas_prices: { slow: number; average: number; fast: number } | null;
  gas_used_today: string | null;
  /** Always null for PEPU — no on-chain price oracle is wired up. Never used to construct a USD figure; see AGENTS.md. */
  coin_price: string | null;
}

export function getAddress(hash: string): Promise<BlockscoutAddress | null> {
  return blockscoutFetch<BlockscoutAddress | null>(`/addresses/${hash}`);
}

export function getAddressCounters(hash: string): Promise<BlockscoutAddressCounters | null> {
  return blockscoutFetch<BlockscoutAddressCounters | null>(`/addresses/${hash}/counters`);
}

export function getAddressTokenBalances(hash: string): Promise<BlockscoutTokenBalance[] | null> {
  return blockscoutFetch<BlockscoutTokenBalance[] | null>(`/addresses/${hash}/token-balances`);
}

export function getTransaction(hash: string): Promise<BlockscoutTransaction | null> {
  return blockscoutFetch<BlockscoutTransaction | null>(`/transactions/${hash}`);
}

export function getSmartContract(hash: string): Promise<BlockscoutSmartContract | null> {
  return blockscoutFetch<BlockscoutSmartContract | null>(`/smart-contracts/${hash}`);
}

export function search(query: string): Promise<BlockscoutSearchResult> {
  return blockscoutFetch<BlockscoutSearchResult>(`/search?q=${encodeURIComponent(query)}`);
}

export function getToken(hash: string): Promise<BlockscoutToken | null> {
  return blockscoutFetch<BlockscoutToken | null>(`/tokens/${hash}`);
}

/**
 * Network-wide stats (block height, tx count, live gas price band). Used by
 * pepu_health_check as a second reachability signal beyond a bare RPC ping,
 * and to cross-check whether pepuscan's index looks caught up with the
 * chain tip. `coin_price` is always null for PEPU (confirmed live) — never
 * surface it as a real figure.
 */
export function getStats(): Promise<BlockscoutStats> {
  return blockscoutFetch<BlockscoutStats>(`/stats`);
}
