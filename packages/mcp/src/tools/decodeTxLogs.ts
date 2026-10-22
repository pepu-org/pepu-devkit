/**
 * pepu_decode_tx_logs
 *
 * WHAT: Decodes any transaction on PEPU mainnet into named event arguments and a
 * decoded top-level call. You pass a transaction hash and, optionally, ABI
 * fragments (a JSON ABI array, or human-readable lines such as
 * "event Swap(address indexed sender, ...)").
 *
 * Each log is decoded by the first source that succeeds, and the result records
 * which one in `source`: (1) "abi", your fragments; (2) "verified", the verified
 * ABI of the emitting contract on pepuscan (proxy implementations included);
 * (3) "pepuscan", pepuscan's own decoded signature for the log, re-decoded
 * locally from the raw topics and data; (4) "builtin", a small offline set of
 * standards (ERC-20/721, WPEPU, ERC-4337 EntryPoint, Uniswap V2/V3 pools);
 * (5) "signature-db", an event signature from 4byte.directory, with the indexed
 * parameters inferred. The top-level input follows the same ladder using the
 * ABI of `tx.to`, pepuscan's decoded call, the built-in functions and 4byte
 * function signatures. Pass offline: true to skip every network lookup.
 *
 * WHEN TO USE: pepu_explain_tx tells you what kind of transaction it was and
 * who paid; use this tool when you need the decoded event arguments (a trade,
 * a transfer, a mint, a contract's own events) instead of decoding the receipt
 * by hand with viem. A UserOperation hash works when PEPU_BUNDLER_URL is set.
 *
 * Read-only: never signs or sends anything. bigint values are returned as
 * decimal strings. A failed lookup never fails the call. Example call:
 *   { hash: "0x..." }
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { explorerLinks, getContract, isDeployed, pepuMainnet, resolvePepuEndpoints } from "@pepu-chain/sdk";
import {
  decodeEventLog,
  decodeFunctionData,
  isAddress,
  isHash,
  parseAbi,
  parseAbiItem,
  toEventSelector,
  toFunctionSelector,
  type AbiEvent,
  type AbiFunction,
  type AbiParameter,
  type Hash,
  type Hex,
  type Log,
} from "viem";
import { REMOTE_READ } from "../annotations.js";
import { actionableError } from "../errors.js";
import { fetchPepuscanInputSignature, fetchPepuscanLogSignatures, fetchVerifiedAbis, lookupEventSignatures, lookupFunctionSignatures, type AbiItemLike } from "../explorer-abi.js";
import { jsonResult } from "../format.js";
import { getPublicClient } from "../rpc.js";
import { hostOf } from "../sdk-helpers.js";
import { isNotFound, userOpToTxHash } from "../userop-resolve.js";

const MAX_LOGS = 200;
/** Indexed-position enumeration is skipped when there are more combinations than this. */
const MAX_COMBINATIONS = 64;

const inputSchema = {
  hash: z.string().describe("A transaction hash (0x + 64 hex), or a UserOperation hash if a bundler URL is configured."),
  abi: z
    .union([z.string(), z.array(z.union([z.string(), z.record(z.string(), z.unknown())]))])
    .optional()
    .describe(
      'Optional ABI tried before every lookup. Either a JSON ABI array, or human-readable fragments such as "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)" or "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256)". A single string is accepted. Event fragments decode logs; function fragments decode the top-level transaction input. Usually not needed: verified contracts decode without it.'
    ),
  address: z.string().optional().describe("Only decode logs emitted by this contract address (case-insensitive)."),
  includeUndecoded: z.boolean().default(true).describe("Also list logs no event matched (topic0, topic count, data length and a hint). Default true."),
  offline: z.boolean().default(false).describe("Skip every network lookup (pepuscan verified ABIs and decoding, the signature database) and decode with your abi and the built-in standards only. Use when pepuscan is unreachable. Default false."),
};

type AbiInput = string | Array<string | Record<string, unknown>> | undefined;

/** Standard events used as an offline fallback. Both ERC-20 and ERC-721 variants are listed: only the one whose topic count matches decodes. */
const BUILTIN_EVENTS = parseAbi([
  // ERC-20
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
  // ERC-721 (same topic0, tokenId is indexed so there are 4 topics)
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)",
  "event ApprovalForAll(address indexed owner, address indexed operator, bool approved)",
  // WPEPU / WETH9
  "event Deposit(address indexed dst, uint256 wad)",
  "event Withdrawal(address indexed src, uint256 wad)",
  // ERC-4337 EntryPoint v0.7
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
  "event BeforeExecution()",
  "event AccountDeployed(bytes32 indexed userOpHash, address indexed sender, address factory, address paymaster)",
  "event UserOperationRevertReason(bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason)",
  "event PostOpRevertReason(bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason)",
  "event Deposited(address indexed account, uint256 totalDeposit)",
  // Uniswap V2 pair
  "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
  "event Sync(uint112 reserve0, uint112 reserve1)",
  "event Mint(address indexed sender, uint256 amount0, uint256 amount1)",
  "event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)",
  // Uniswap V3 pool (PepuSwap is a Uniswap V3 fork)
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
  "event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
  "event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
  "event Collect(address indexed owner, address recipient, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount0, uint128 amount1)",
]) as readonly AbiEvent[];

/** Built-in function fragments for the top-level input, an offline fallback. */
const BUILTIN_FUNCTIONS = parseAbi([
  // ERC-4337 EntryPoint v0.7
  "function handleOps((address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] ops, address beneficiary)",
  // Uniswap Universal Router (PepuSwap)
  "function execute(bytes commands, bytes[] inputs, uint256 deadline)",
  "function execute(bytes commands, bytes[] inputs)",
  // ERC-20 and WPEPU
  "function transfer(address to, uint256 amount)",
  "function transferFrom(address from, address to, uint256 amount)",
  "function approve(address spender, uint256 amount)",
  "function deposit()",
  "function withdraw(uint256 wad)",
]) as readonly AbiFunction[];

type LogSource = "abi" | "verified" | "pepuscan" | "builtin" | "signature-db";

/** Canonical type string, expanding tuples: (address,uint256)[]. */
function canonicalType(p: AbiParameter): string {
  if (p.type.startsWith("tuple")) {
    const comps = (p as AbiParameter & { components?: readonly AbiParameter[] }).components ?? [];
    return `(${comps.map(canonicalType).join(",")})${p.type.slice("tuple".length)}`;
  }
  return p.type;
}

function signatureOf(item: { name: string; inputs: readonly AbiParameter[] }): string {
  return `${item.name}(${item.inputs.map(canonicalType).join(",")})`;
}

function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toJsonSafe(v)]));
  }
  return value;
}

/** Named object for decoded args; unnamed params use their position as the key. */
function namedArgs(inputs: readonly AbiParameter[], decoded: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (Array.isArray(decoded)) {
    inputs.forEach((p, i) => {
      out[p.name ? p.name : String(i)] = toJsonSafe(decoded[i]);
    });
  } else if (decoded && typeof decoded === "object") {
    for (const [k, v] of Object.entries(decoded as Record<string, unknown>)) out[k] = toJsonSafe(v);
  }
  return out;
}

type UserAbi = { events: AbiEvent[]; functions: AbiFunction[] };

function parseFragment(text: string): { type: string } {
  const attempts = /^(event|function|error|constructor|struct)\s/.test(text) ? [text] : [`event ${text}`, `function ${text}`];
  let lastError: unknown;
  for (const a of attempts) {
    try {
      return parseAbiItem(a) as { type: string };
    } catch (e) {
      lastError = e;
    }
  }
  return actionableError(
    `Could not parse the ABI fragment "${text}".`,
    `Parser said: ${(lastError instanceof Error ? (lastError.message.split("\n")[0] ?? "invalid syntax") : "invalid syntax").replace(/\.$/, "")}.`,
    'Write it as a Solidity declaration with its keyword, e.g. "event Transfer(address indexed from, address indexed to, uint256 value)" or "function transfer(address to, uint256 amount)". Parameter types must be valid (uint256, address, bytes32, tuple types in parentheses).'
  );
}

function collectAbi(input: AbiInput): UserAbi {
  const result: UserAbi = { events: [], functions: [] };
  if (input === undefined) return result;
  let entries: Array<string | Record<string, unknown>>;
  if (typeof input === "string") {
    const t = input.trim();
    if (t.startsWith("[")) {
      try {
        entries = JSON.parse(t) as Array<string | Record<string, unknown>>;
      } catch {
        return actionableError("The abi string looks like JSON but could not be parsed.", "It starts with [ yet is not valid JSON.", 'Pass a JSON array of ABI items, or one human-readable fragment such as "event Transfer(address indexed from, address indexed to, uint256 value)".');
      }
    } else {
      entries = [t];
    }
  } else {
    entries = input;
  }
  entries.forEach((entry, i) => {
    let item: { type?: unknown };
    if (typeof entry === "string") {
      item = parseFragment(entry.trim());
    } else {
      item = entry;
      const label = `abi[${i}]${typeof entry["name"] === "string" ? ` ("${entry["name"]}")` : ""}`;
      if (typeof entry["type"] !== "string") {
        actionableError(`The ABI item ${label} has no "type".`, "Each JSON ABI item needs type: 'event', 'function', and so on.", "Add the type, or pass the fragment as a human-readable string.");
      }
      try {
        if (entry["type"] === "event") toEventSelector(entry as unknown as AbiEvent);
        else if (entry["type"] === "function") toFunctionSelector(entry as unknown as AbiFunction);
      } catch (e) {
        actionableError(`The ABI item ${label} is malformed.`, `${e instanceof Error ? e.message.split("\n")[0] : "Invalid item"}.`, "Check that name, inputs (each with a valid type) and indexed flags are present.");
      }
    }
    if (item.type === "event") result.events.push(item as AbiEvent);
    else if (item.type === "function") result.functions.push({ inputs: [], outputs: [], stateMutability: "nonpayable", ...(item as object) } as unknown as AbiFunction);
  });
  return result;
}

/** Events and functions from a lookup ABI. Items that fail to hash are dropped rather than failing the call. */
function splitLookupAbi(items: readonly AbiItemLike[]): UserAbi {
  const out: UserAbi = { events: [], functions: [] };
  for (const item of items) {
    try {
      if (item["type"] === "event") {
        toEventSelector(item as unknown as AbiEvent);
        out.events.push(item as unknown as AbiEvent);
      } else if (item["type"] === "function") {
        const fn = { inputs: [], outputs: [], stateMutability: "nonpayable", ...item } as unknown as AbiFunction;
        toFunctionSelector(fn);
        out.functions.push(fn);
      }
    } catch {
      // Malformed entry in a third-party ABI; ignore it.
    }
  }
  return out;
}

type LogEntry = Record<string, unknown>;

function selectorOfEvent(e: AbiEvent): string | null {
  try {
    return toEventSelector(e).toLowerCase();
  } catch {
    return null;
  }
}

/** Try each event whose selector matches topic0, strictly; first that decodes wins. */
function decodeWith(events: readonly AbiEvent[], log: Log, source: LogSource): LogEntry | null {
  const topic0 = log.topics[0]?.toLowerCase();
  if (!topic0) return null;
  for (const event of events) {
    if (selectorOfEvent(event) !== topic0) continue;
    try {
      const decoded = decodeEventLog({ abi: [event], data: log.data, topics: log.topics as [Hex, ...Hex[]], strict: true });
      return {
        logIndex: log.logIndex,
        address: log.address,
        eventName: event.name,
        signature: signatureOf(event),
        source,
        args: namedArgs(event.inputs, (decoded as { args?: unknown }).args),
      };
    } catch {
      // Topic count or data shape does not fit this candidate; try the next.
    }
  }
  return null;
}

function parseEventSignature(text: string): AbiEvent | null {
  try {
    const item = parseAbiItem(`event ${text}`);
    return item.type === "event" ? (item as AbiEvent) : null;
  } catch {
    return null;
  }
}

function combinations(n: number, k: number): number[][] {
  const out: number[][] = [];
  const walk = (start: number, acc: number[]): void => {
    if (acc.length === k) {
      out.push(acc);
      return;
    }
    for (let i = start; i < n; i++) walk(i + 1, [...acc, i]);
  };
  walk(0, []);
  return out;
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

/** Decode with a type-only signature by guessing which parameters are indexed. */
function decodeBySignature(signatures: readonly string[], log: Log): LogEntry | null {
  const topic0 = log.topics[0]?.toLowerCase();
  if (!topic0) return null;
  const k = log.topics.length - 1;
  for (const text of signatures) {
    const parsed = parseEventSignature(text);
    if (!parsed || selectorOfEvent(parsed) !== topic0) continue;
    const n = parsed.inputs.length;
    if (k > n || choose(n, k) > MAX_COMBINATIONS) continue;
    const hits: LogEntry[] = [];
    for (const combo of combinations(n, k)) {
      const event: AbiEvent = { ...parsed, inputs: parsed.inputs.map((p, i) => ({ ...p, indexed: combo.includes(i) })) as AbiEvent["inputs"] };
      const decoded = decodeWith([event], log, "signature-db");
      if (decoded) hits.push(decoded);
    }
    if (hits.length === 0) continue;
    const first = hits[0] as LogEntry;
    return hits.length > 1 ? { ...first, ambiguous: true, note: "Indexed positions were guessed from the signature (several layouts decode); confirm against the contract's ABI." } : first;
  }
  return null;
}

function decodeInputWith(fns: readonly AbiFunction[], data: Hex, selector: string, source: string): Record<string, unknown> | null {
  for (const fn of fns) {
    try {
      if (toFunctionSelector(fn).toLowerCase() !== selector) continue;
      const d = decodeFunctionData({ abi: [fn], data });
      return { selector, functionName: fn.name, signature: signatureOf(fn), source, args: namedArgs(fn.inputs, d.args) };
    } catch {
      // Selector or calldata shape does not fit; try the next.
    }
  }
  return null;
}

function parseFunctionSignature(text: string): AbiFunction | null {
  try {
    const item = parseAbiItem(`function ${text}`);
    return item.type === "function" ? (item as AbiFunction) : null;
  } catch {
    return null;
  }
}

export function registerDecodeTxLogsTool(server: McpServer): void {
  server.registerTool(
    "pepu_decode_tx_logs",
    {
      title: "Decode PEPU transaction logs",
      description:
        "Decode any PEPU mainnet transaction into named event arguments and a decoded top-level call, from its hash alone. Each log is tried against, in order: your optional abi (JSON ABI array or fragments like \"event Swap(address indexed sender, ...)\"), the verified ABI of the emitting contract on pepuscan (proxy implementations included), pepuscan's own decoded signature re-decoded locally from the raw log, a built-in set of standards (ERC-20/721, WPEPU, ERC-4337 EntryPoint, Uniswap V2/V3 pools), and finally a public signature database that names the event and infers its indexed parameters. Every decoded log and the input carry a `source` saying which one matched; a `lookups` summary shows what was consulted. Undecoded logs are listed with a hint and candidate signatures. The input is decoded from your abi, the verified ABI of the target, pepuscan, the built-ins, or the signature database. Set offline: true to skip all network lookups; a failed lookup never fails the call. bigints are returned as decimal strings; pepuscan links come from explorerLinks in @pepu-chain/sdk. Use pepu_explain_tx first for the transaction kind, payer and fee; use this tool for decoded event args. A UserOperation hash works when PEPU_BUNDLER_URL is set. Read-only; never signs or sends.",
      inputSchema,
      annotations: REMOTE_READ,
    },
    async ({ hash, abi, address, includeUndecoded, offline }) => {
      if (!isHash(hash)) {
        actionableError(`"${hash}" is not a transaction or UserOperation hash.`, "It must be 0x followed by 64 hex characters.", "Copy the full hash from your wallet or pepuscan.");
      }
      if (address !== undefined && !isAddress(address, { strict: false })) {
        actionableError(`"${address}" is not a valid EVM address.`, "The address filter must be 0x followed by 40 hex characters.", "Pass the emitting contract's address, or omit the filter.");
      }
      const userAbi = collectAbi(abi);

      const client = getPublicClient("mainnet");
      let txHash: Hash = hash;
      let resolvedFromUserOp = false;
      let tx;
      try {
        tx = await client.getTransaction({ hash: txHash });
      } catch (e) {
        if (!isNotFound(e)) throw e;
        let bundlerUrl: string | null = null;
        try {
          bundlerUrl = resolvePepuEndpoints().bundlerUrl;
        } catch {
          bundlerUrl = null;
        }
        const resolved = bundlerUrl ? await userOpToTxHash(bundlerUrl, hash) : null;
        if (!resolved) {
          return actionableError(
            bundlerUrl
              ? `No transaction with hash ${hash} on PEPU mainnet, and the bundler at ${hostOf(bundlerUrl)} has no UserOperation receipt for it.`
              : `No transaction with hash ${hash} on PEPU mainnet.`,
            "It may be pending, dropped, or from another chain; if it is a UserOperation hash, a bundler is needed to resolve it.",
            bundlerUrl ? "Check the hash and the chain (mainnet 97741 only)." : "Check the hash and the chain (mainnet 97741 only), or set PEPU_BUNDLER_URL to resolve a UserOperation hash."
          );
        }
        txHash = resolved;
        resolvedFromUserOp = true;
        tx = await client.getTransaction({ hash: txHash });
      }

      const receipt = await client.getTransactionReceipt({ hash: txHash }).catch((e: unknown) => {
        if (isNotFound(e)) return null;
        throw e;
      });
      if (!receipt) {
        return actionableError(`Transaction ${txHash} has no receipt yet.`, "It was found but is still pending, so it has no logs to decode.", "Wait for it to be mined and call this tool again.");
      }

      const wanted = address?.toLowerCase();
      const considered = wanted ? receipt.logs.filter((l) => l.address.toLowerCase() === wanted) : receipt.logs;
      const selector = tx.input.length >= 10 ? tx.input.slice(0, 10).toLowerCase() : null;

      const lookups: { verifiedAbis: number; pepuscanLogs: "ok" | "failed" | "skipped"; signatureDb: number } = { verifiedAbis: 0, pepuscanLogs: "skipped", signatureDb: 0 };

      // Step 1: the caller's ABI.
      const results: Array<LogEntry | null> = considered.map((log) => decodeWith(userAbi.events, log, "abi"));
      const remaining = (): number[] => results.flatMap((r, i) => (r ? [] : [i]));

      // The top-level input is tried against the caller's ABI as well, before any lookup.
      let input: Record<string, unknown> | null = null;
      if (selector) input = decodeInputWith(userAbi.functions, tx.input, selector, "abi");

      // Step 2: verified ABIs of the emitting contracts, and of tx.to for the input.
      if (!offline) {
        const wantAddresses = remaining().map((i) => (considered[i] as Log).address as string);
        if (selector && !input && tx.to) wantAddresses.push(tx.to);
        let verified = new Map<string, AbiItemLike[]>();
        if (wantAddresses.length > 0) {
          try {
            const v = await fetchVerifiedAbis(wantAddresses);
            verified = v.byAddress;
            lookups.verifiedAbis = v.withAbi;
          } catch {
            // Lookups never fail the call.
          }
        }
        const split = new Map<string, UserAbi>();
        const abiOf = (addr: string): UserAbi => {
          const key = addr.toLowerCase();
          let s = split.get(key);
          if (!s) {
            s = splitLookupAbi(verified.get(key) ?? []);
            split.set(key, s);
          }
          return s;
        };
        for (const i of remaining()) {
          const log = considered[i] as Log;
          results[i] = decodeWith(abiOf(log.address).events, log, "verified");
        }
        if (selector && !input && tx.to) input = decodeInputWith(abiOf(tx.to).functions, tx.input, selector, "verified");
      }

      // Step 3: pepuscan's own decoding, re-decoded locally from the raw log.
      if (!offline && remaining().length > 0) {
        try {
          const sigs = await fetchPepuscanLogSignatures(txHash, MAX_LOGS);
          lookups.pepuscanLogs = sigs ? "ok" : "failed";
          if (sigs) {
            for (const i of remaining()) {
              const log = considered[i] as Log;
              const methodCall = sigs.get(Number(log.logIndex));
              const event = methodCall ? parseEventSignature(methodCall) : null;
              if (event) results[i] = decodeWith([event], log, "pepuscan");
            }
          }
        } catch {
          lookups.pepuscanLogs = "failed";
        }
      }

      // Step 4: the built-in standards.
      for (const i of remaining()) results[i] = decodeWith(BUILTIN_EVENTS, considered[i] as Log, "builtin");

      // Step 5: signature database for whatever is still undecoded.
      const candidates = new Map<string, string[]>();
      if (!offline) {
        const topics = remaining().flatMap((i) => {
          const t = (considered[i] as Log).topics[0];
          return t ? [t] : [];
        });
        if (topics.length > 0) {
          try {
            const found = await lookupEventSignatures(topics);
            lookups.signatureDb = found.size;
            for (const [t, sigs] of found) candidates.set(t, sigs);
          } catch {
            // Lookups never fail the call.
          }
          for (const i of remaining()) {
            const log = considered[i] as Log;
            const sigs = candidates.get(log.topics[0]?.toLowerCase() ?? "");
            if (sigs) results[i] = decodeBySignature(sigs, log);
          }
        }
      }

      const entries: LogEntry[] = [];
      let decodedCount = 0;
      let undecodedCount = 0;
      considered.forEach((log, i) => {
        const decoded = results[i];
        if (decoded) {
          decodedCount++;
          entries.push(decoded);
        } else {
          undecodedCount++;
          if (includeUndecoded) {
            const sigs = candidates.get(log.topics[0]?.toLowerCase() ?? "");
            entries.push({
              logIndex: log.logIndex,
              address: log.address,
              decoded: false,
              topic0: log.topics[0] ?? null,
              topicCount: log.topics.length,
              dataLength: (log.data.length - 2) / 2,
              ...(sigs && sigs.length > 0 ? { candidateSignatures: sigs } : {}),
              hint: log.topics[0]
                ? `No matching event. Add the event fragment to abi (for example "event Name(type indexed a, type b)" whose selector is ${log.topics[0]}) to decode it.`
                : "Anonymous log (no topics); it cannot be matched by selector.",
            });
          }
        }
      });
      const truncated = entries.length > MAX_LOGS;
      const logs = truncated ? entries.slice(0, MAX_LOGS) : entries;

      // Top-level input, remaining steps: pepuscan's decoded call, built-ins, then the signature database.
      if (selector && !input) {
        if (!offline) {
          try {
            const methodCall = await fetchPepuscanInputSignature(txHash);
            const fn = methodCall ? parseFunctionSignature(methodCall) : null;
            // pepuscan names unnamed parameters arg0, arg1...; a matching standard keeps the real names.
            const unnamed = fn !== null && fn.inputs.some((p) => !p.name || /^arg\d+$/.test(p.name));
            if (fn && unnamed) input = decodeInputWith(BUILTIN_FUNCTIONS, tx.input, selector, "builtin");
            if (fn && !input) input = decodeInputWith([fn], tx.input, selector, "pepuscan");
          } catch {
            // Lookups never fail the call.
          }
        }
        if (!input) input = decodeInputWith(BUILTIN_FUNCTIONS, tx.input, selector, "builtin");
        if (!input && !offline) {
          try {
            const sigs = await lookupFunctionSignatures(selector);
            lookups.signatureDb += 1;
            const fns = sigs.map(parseFunctionSignature).filter((f): f is AbiFunction => f !== null);
            input = decodeInputWith(fns, tx.input, selector, "signature-db");
            if (!input && sigs.length > 0) input = { selector, decoded: false, candidateSignatures: sigs, hint: "The signature database knows this selector but none of its signatures decode the calldata. Pass the exact function fragment in abi." };
          } catch {
            // Lookups never fail the call.
          }
        }
        if (!input) input = { selector, decoded: false, hint: 'Add a function fragment to abi (for example "function name(type a, type b)") with this selector to decode the input.' };
      }

      const entryPoints = new Set(
        (["entryPoint06", "entryPoint07"] as const)
          .map((k) => getContract(pepuMainnet.id, k))
          .filter(isDeployed)
          .map((c) => c.address.toLowerCase())
      );
      const toEntryPoint = tx.to !== null && tx.to !== undefined && entryPoints.has(tx.to.toLowerCase());
      const notes: string[] = [];
      if (toEntryPoint) {
        notes.push(
          "This transaction is sent to the EntryPoint, so it is an ERC-4337 handleOps bundle. The inner account calldata is not decoded here; read the decoded UserOperationEvent logs (userOpHash, sender, paymaster, success, actualGasCost) and the events emitted by the called contracts. Use pepu_explain_tx for who paid gas."
        );
      }
      if (truncated) notes.push(`Output is capped at ${MAX_LOGS} logs; narrow it with the address filter.`);
      if (offline) notes.push("offline: true, so no pepuscan or signature-database lookups were made; only your abi and the built-in standards were used.");

      return jsonResult({
        txHash,
        ...(resolvedFromUserOp ? { resolvedFromUserOpHash: hash } : {}),
        status: receipt.status,
        from: tx.from,
        to: tx.to ?? null,
        block: receipt.blockNumber.toString(),
        logCount: receipt.logs.length,
        ...(wanted ? { filteredLogCount: considered.length } : {}),
        decodedCount,
        undecodedCount,
        truncated,
        lookups,
        ...(input ? { input } : {}),
        ...(notes.length > 0 ? { notes } : {}),
        logs,
        links: explorerLinks({ tx: txHash, address: tx.from }),
        sdkFunctions: "explorerLinks (@pepu-chain/sdk); decodeEventLog, decodeFunctionData (viem)",
      });
    }
  );
}
