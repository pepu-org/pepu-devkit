import type { Abi, Address } from "viem";

import type { PepuChain } from "./chains.js";

/**
 * A minimal client for pepuscan's (Blockscout's) public REST API —
 * deliberately narrow: **verified-ABI and token-metadata reads only**.
 * Blockscout's API surface is large (transaction history, logs, internal
 * txs, NFTs, account-abstraction data, ...); re-wrapping all of it here
 * would duplicate `@pepu-chain/mcp` (the Blockscout MCP server), which is the
 * right place for that. This client exists only for the two lookups a
 * dapp commonly needs synchronously and that this package's own ABI/token
 * modules can't provide (an address this package hasn't independently
 * verified, or a token not yet in {@link pepuTokenList}).
 *
 * Uses the platform `fetch` (Node 18+, every evergreen browser) — no HTTP
 * client dependency.
 */
export interface PepuscanClient {
  /**
   * Fetch a contract's verified ABI from pepuscan. Resolves `null` if the
   * contract is not verified (a 404 from Blockscout's
   * `/v2/smart-contracts/{address}`) rather than throwing, since "not
   * verified" is an expected, ordinary result — not an error.
   */
  getVerifiedAbi(address: Address): Promise<Abi | null>;
  /**
   * Fetch a token's on-chain metadata from pepuscan
   * (`/v2/tokens/{address}`). Resolves `null` if pepuscan has no record of
   * the address as a token (a 404) — the address may still be a valid
   * contract; it just isn't a token Blockscout has indexed as one.
   */
  getTokenMetadata(address: Address): Promise<PepuscanTokenMetadata | null>;
}

/** Token metadata as reported by pepuscan's `/v2/tokens/{address}`. */
export interface PepuscanTokenMetadata {
  readonly address: Address;
  readonly name: string | null;
  readonly symbol: string | null;
  /** `null` for token types that don't have a fixed decimals field (e.g. most ERC-721s). */
  readonly decimals: number | null;
  readonly totalSupply: string | null;
  /** Blockscout's token type string, e.g. `"ERC-20"`, `"ERC-721"`, `"ERC-1155"`. */
  readonly type: string | null;
}

interface BlockscoutSmartContractResponse {
  readonly abi?: Abi | null;
}

interface BlockscoutTokenResponse {
  readonly name?: string | null;
  readonly symbol?: string | null;
  readonly decimals?: string | null;
  readonly total_supply?: string | null;
  readonly type?: string | null;
}

function requireApiUrl(chain: PepuChain): string {
  const apiUrl = chain.blockExplorers?.default.apiUrl;
  if (!apiUrl) {
    throw new Error(
      `createPepuscanClient: no Blockscout API URL configured for chain "${chain.name}" (id ${chain.id}).`,
    );
  }
  return apiUrl;
}

async function getJsonOrNull<T>(url: string): Promise<T | null> {
  const response = await fetch(url);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`pepuscan: GET ${url} failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * Create a {@link PepuscanClient} bound to a {@link PepuChain}'s configured
 * Blockscout API URL (`chain.blockExplorers.default.apiUrl`). Throws
 * immediately if the chain has none configured (currently
 * {@link pepuTestnet} — see `chains.ts`) rather than deferring the failure
 * to the first call.
 */
export function createPepuscanClient(chain: PepuChain): PepuscanClient {
  const apiUrl = requireApiUrl(chain);

  return {
    async getVerifiedAbi(address) {
      const body = await getJsonOrNull<BlockscoutSmartContractResponse>(
        `${apiUrl}/v2/smart-contracts/${address}`,
      );
      return body?.abi ?? null;
    },
    async getTokenMetadata(address) {
      const body = await getJsonOrNull<BlockscoutTokenResponse>(
        `${apiUrl}/v2/tokens/${address}`,
      );
      if (!body) {
        return null;
      }
      return {
        address,
        name: body.name ?? null,
        symbol: body.symbol ?? null,
        decimals: body.decimals != null ? Number(body.decimals) : null,
        totalSupply: body.total_supply ?? null,
        type: body.type ?? null,
      };
    },
  };
}
