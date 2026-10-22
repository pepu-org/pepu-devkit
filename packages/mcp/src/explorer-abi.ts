/**
 * Network lookups used by pepu_decode_tx_logs to decode contracts the server
 * has no built-in knowledge of: verified ABIs and pepuscan's own decoding
 * (pepuscan.com, Blockscout v2), and the public 4byte.directory signature
 * database. Every helper takes an injectable fetch, enforces a per-request
 * timeout and never throws: a failed lookup yields "no information".
 */

import { BLOCKSCOUT_BASE } from "./blockscout.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const FOURBYTE_BASE = "https://www.4byte.directory/api/v1";
export const LOOKUP_TIMEOUT_MS = 8_000;
/** Distinct contract addresses whose verified ABI is fetched per call. */
export const MAX_VERIFIED_ADDRESSES = 25;
/** Extra proxy implementation fetches allowed per call. */
export const MAX_IMPLEMENTATIONS = 10;
/** Distinct topic0 values looked up in the signature database per call. */
export const MAX_SIGNATURE_LOOKUPS = 20;

export type AbiItemLike = Record<string, unknown>;

export interface LookupOptions {
  fetchFn?: FetchLike;
  timeoutMs?: number;
}

function defaultFetch(input: string, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}

/** GET a URL and parse JSON. Returns null on any network, HTTP or parse failure. */
export async function getJson(url: string, opts: LookupOptions = {}): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? LOOKUP_TIMEOUT_MS);
  try {
    const res = await (opts.fetchFn ?? defaultFetch)(url, { headers: { accept: "application/json" }, signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asAbi(v: unknown): AbiItemLike[] {
  return Array.isArray(v) ? v.filter((i): i is AbiItemLike => !!asRecord(i)) : [];
}

export interface VerifiedAbis {
  /** Lowercase address -> merged ABI (own plus proxy implementations). Empty array when unverified or unreachable. */
  byAddress: Map<string, AbiItemLike[]>;
  /** Addresses that returned a non-empty verified ABI. */
  withAbi: number;
}

/** Fetch the verified ABI of each distinct address once, in parallel. Proxy implementation ABIs are merged in. */
export async function fetchVerifiedAbis(addresses: string[], opts: LookupOptions = {}): Promise<VerifiedAbis> {
  const distinct = [...new Set(addresses.map((a) => a.toLowerCase()))].slice(0, MAX_VERIFIED_ADDRESSES);
  const cache = new Map<string, Promise<{ abi: AbiItemLike[]; impls: string[] }>>();
  let implBudget = MAX_IMPLEMENTATIONS;

  const fetchOne = (address: string): Promise<{ abi: AbiItemLike[]; impls: string[] }> => {
    const cached = cache.get(address);
    if (cached) return cached;
    const p = (async () => {
      const body = asRecord(await getJson(`${BLOCKSCOUT_BASE}/smart-contracts/${address}`, opts));
      if (!body) return { abi: [], impls: [] };
      const impls = (Array.isArray(body["implementations"]) ? body["implementations"] : [])
        .map((i) => asRecord(i))
        .map((i) => (typeof i?.["address"] === "string" ? i["address"] : typeof i?.["address_hash"] === "string" ? i["address_hash"] : null))
        .filter((a): a is string => a !== null)
        .map((a) => a.toLowerCase());
      return { abi: body["is_verified"] === false ? [] : asAbi(body["abi"]), impls };
    })();
    cache.set(address, p);
    return p;
  };

  const byAddress = new Map<string, AbiItemLike[]>();
  await Promise.all(
    distinct.map(async (address) => {
      const own = await fetchOne(address);
      const merged = [...own.abi];
      const impls = own.impls.filter((a) => a !== address).slice(0, 3);
      const fetched = await Promise.all(
        impls.map((a) => {
          if (!cache.has(a)) {
            if (implBudget <= 0) return Promise.resolve({ abi: [] as AbiItemLike[], impls: [] as string[] });
            implBudget--;
          }
          return fetchOne(a);
        })
      );
      for (const f of fetched) merged.push(...f.abi);
      byAddress.set(address, merged);
    })
  );
  let withAbi = 0;
  for (const abi of byAddress.values()) if (abi.length > 0) withAbi++;
  return { byAddress, withAbi };
}

/** Pepuscan's own event decoding for a transaction, as signature strings keyed by log index. Null when the lookup failed. */
export async function fetchPepuscanLogSignatures(txHash: string, maxItems: number, opts: LookupOptions = {}): Promise<Map<number, string> | null> {
  const out = new Map<number, string>();
  let query = "";
  let seen = 0;
  for (let page = 0; page < 10 && seen < maxItems; page++) {
    const body = asRecord(await getJson(`${BLOCKSCOUT_BASE}/transactions/${txHash}/logs${query}`, opts));
    if (!body || !Array.isArray(body["items"])) return page === 0 ? null : out;
    for (const raw of body["items"]) {
      const item = asRecord(raw);
      if (!item) continue;
      seen++;
      const decoded = asRecord(item["decoded"]);
      const index = typeof item["index"] === "number" ? item["index"] : Number(item["index"]);
      if (decoded && typeof decoded["method_call"] === "string" && Number.isInteger(index)) out.set(index, decoded["method_call"]);
    }
    const next = asRecord(body["next_page_params"]);
    if (!next) break;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v !== null && v !== undefined) params.set(k, String(v));
    query = `?${params.toString()}`;
  }
  return out;
}

/** Pepuscan's decoded top-level call signature (for example "handleOps((address,...)[] ops, address beneficiary)"), or null. */
export async function fetchPepuscanInputSignature(txHash: string, opts: LookupOptions = {}): Promise<string | null> {
  const body = asRecord(await getJson(`${BLOCKSCOUT_BASE}/transactions/${txHash}`, opts));
  const decoded = asRecord(body?.["decoded_input"]);
  return typeof decoded?.["method_call"] === "string" ? decoded["method_call"] : null;
}

async function fourByte(kind: "event-signatures" | "signatures", hex: string, opts: LookupOptions): Promise<string[]> {
  const body = asRecord(await getJson(`${FOURBYTE_BASE}/${kind}/?hex_signature=${hex}`, opts));
  const results = Array.isArray(body?.["results"]) ? (body["results"] as unknown[]) : [];
  return results
    .map((r) => asRecord(r)?.["text_signature"])
    .filter((t): t is string => typeof t === "string");
}

/** topic0 (lowercase) -> candidate text signatures from the signature database. Capped and parallel. */
export async function lookupEventSignatures(topic0s: string[], opts: LookupOptions = {}): Promise<Map<string, string[]>> {
  const distinct = [...new Set(topic0s.map((t) => t.toLowerCase()))].slice(0, MAX_SIGNATURE_LOOKUPS);
  const out = new Map<string, string[]>();
  await Promise.all(distinct.map(async (t) => out.set(t, await fourByte("event-signatures", t, opts))));
  return out;
}

/** 4-byte selector -> candidate function text signatures from the signature database. */
export function lookupFunctionSignatures(selector: string, opts: LookupOptions = {}): Promise<string[]> {
  return fourByte("signatures", selector, opts);
}
