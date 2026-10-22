import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbi, pad, type Hex } from "viem";
import { ENTRYPOINT_V07_ADDRESS } from "../constants.js";
import { createTestClient, isError, jsonOf, textOf } from "../test-helpers.js";

const hash = ("0x" + "11".repeat(32)) as Hex;
const blockHash = "0x" + "22".repeat(32);
const from = "0x1111111111111111111111111111111111111111";
const to = "0x2222222222222222222222222222222222222222";
const token = "0x3333333333333333333333333333333333333333";
const other = "0x4444444444444444444444444444444444444444";

interface RpcLog {
  address: string;
  topics: Hex[];
  data: Hex;
}

/** Web lookups (pepuscan, 4byte) seen by the mocked fetch, in order. */
let webCalls: string[] = [];

/**
 * Mocks fetch. JSON-RPC POSTs are answered from `handlers`. Any other request is a web lookup:
 * `web` maps a URL substring to a JSON body (longest match wins); an unmatched URL answers 404,
 * and web === "reject" makes every lookup fail with a network error.
 */
function rpc(handlers: Record<string, unknown>, web: Record<string, unknown> | "reject" = "reject"): void {
  webCalls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: string, init?: RequestInit) => {
      if (init?.body === undefined) {
        webCalls.push(String(u));
        if (web === "reject") throw new TypeError("fetch failed");
        const key = Object.keys(web)
          .filter((k) => String(u).includes(k))
          .sort((a, b) => b.length - a.length)[0];
        if (!key) return new Response("{}", { status: 404 });
        return new Response(JSON.stringify(web[key]), { status: 200, headers: { "content-type": "application/json" } });
      }
      const body = JSON.parse(String(init.body)) as { id: number; method: string };
      const result = handlers[body.method];
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: result ?? null }), { status: 200, headers: { "content-type": "application/json" } });
    })
  );
}

function mockTx(logs: RpcLog[], opts: { input?: Hex; to?: string; status?: string; web?: Record<string, unknown> | "reject" } = {}): void {
  rpc(
    {
    eth_getTransactionByHash: { hash, from, to: opts.to ?? to, value: "0x0", input: opts.input ?? "0x", nonce: "0x1", gas: "0x5208", gasPrice: "0x1", blockNumber: "0x10", blockHash, transactionIndex: "0x0", type: "0x0", v: "0x1c", r: "0x1", s: "0x1" },
    eth_getTransactionReceipt: {
      transactionHash: hash,
      from,
      to: opts.to ?? to,
      status: opts.status ?? "0x1",
      gasUsed: "0x5208",
      effectiveGasPrice: "0x1",
      blockNumber: "0x10",
      blockHash,
      transactionIndex: "0x0",
      cumulativeGasUsed: "0x5208",
      logsBloom: "0x" + "00".repeat(256),
      type: "0x0",
      contractAddress: null,
      logs: logs.map((l, i) => ({ ...l, blockNumber: "0x10", blockHash, transactionHash: hash, transactionIndex: "0x0", logIndex: "0x" + i.toString(16), removed: false })),
    },
    },
    opts.web ?? "reject"
  );
}

const erc20 = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const erc721 = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"]);
const swapAbi = parseAbi(["event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)"]);

function transferLog(address: string, value: bigint): RpcLog {
  return {
    address,
    topics: encodeEventTopics({ abi: erc20, eventName: "Transfer", args: { from, to } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
  };
}

function swapLog(address: string): RpcLog {
  return {
    address,
    topics: encodeEventTopics({ abi: swapAbi, eventName: "Swap", args: { sender: from, to } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [0n, 1000000000000000000n, 5n, 0n]),
  };
}

const SWAP_FRAGMENT = "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)";

type Out = {
  txHash: string;
  status: string;
  from: string;
  to: string;
  block: string;
  logCount: number;
  decodedCount: number;
  undecodedCount: number;
  truncated: boolean;
  logs: Array<Record<string, unknown> & { args?: Record<string, unknown> }>;
  input?: Record<string, unknown>;
  notes?: string[];
  links: { tx: string };
  lookups: { verifiedAbis: number; pepuscanLogs: string; signatureDb: number };
};

async function call(args: Record<string, unknown>) {
  const client = await createTestClient();
  return client.callTool({ name: "pepu_decode_tx_logs", arguments: args });
}

describe("pepu_decode_tx_logs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects a malformed hash", async () => {
    expect(isError(await call({ hash: "0x12" }))).toBe(true);
  });

  it("returns an actionable error when the transaction is not found", async () => {
    rpc({});
    const res = await call({ hash });
    expect(isError(res)).toBe(true);
    expect(textOf(res)).toMatch(/No transaction with hash/);
    expect(textOf(res)).toMatch(/PEPU_BUNDLER_URL|bundler/);
  });

  it("decodes an ERC-20 Transfer from the built-in set with bigints as decimal strings", async () => {
    mockTx([transferLog(token, 123456789012345678901234567890n)]);
    const out = jsonOf(await call({ hash })) as Out;
    expect(out.status).toBe("success");
    expect(out.block).toBe("16");
    expect(out.logCount).toBe(1);
    expect(out.decodedCount).toBe(1);
    expect(out.undecodedCount).toBe(0);
    expect(out.truncated).toBe(false);
    expect(out.links.tx).toBe(`https://pepuscan.com/tx/${hash}`);
    const log = out.logs[0]!;
    expect(log["eventName"]).toBe("Transfer");
    expect(log["signature"]).toBe("Transfer(address,address,uint256)");
    expect(log["source"]).toBe("builtin");
    expect(log["logIndex"]).toBe(0);
    expect(log.args).toEqual({ from, to, value: "123456789012345678901234567890" });
  });

  it("decodes an ERC-721 Transfer (4 topics) with tokenId", async () => {
    mockTx([
      {
        address: token,
        topics: encodeEventTopics({ abi: erc721, eventName: "Transfer", args: { from, to, tokenId: 42n } }) as Hex[],
        data: "0x",
      },
    ]);
    const out = jsonOf(await call({ hash })) as Out;
    expect(out.logs[0]!["signature"]).toBe("Transfer(address,address,uint256)");
    expect(out.logs[0]!.args).toEqual({ from, to, tokenId: "42" });
  });

  it("decodes with a human-readable fragment and marks the source as abi", async () => {
    mockTx([swapLog(token)]);
    const out = jsonOf(await call({ hash, abi: [SWAP_FRAGMENT] })) as Out;
    const log = out.logs[0]!;
    expect(log["source"]).toBe("abi");
    expect(log["eventName"]).toBe("Swap");
    expect(log.args).toEqual({ sender: from, amount0In: "0", amount1In: "1000000000000000000", amount0Out: "5", amount1Out: "0", to });
  });

  it("accepts a single string fragment and a fragment without the event keyword", async () => {
    mockTx([swapLog(token)]);
    const a = jsonOf(await call({ hash, abi: SWAP_FRAGMENT })) as Out;
    expect(a.logs[0]!["source"]).toBe("abi");
    const b = jsonOf(await call({ hash, abi: SWAP_FRAGMENT.replace("event ", "") })) as Out;
    expect(b.logs[0]!["source"]).toBe("abi");
  });

  it("decodes with a JSON ABI array", async () => {
    mockTx([swapLog(token)]);
    const jsonAbi = swapAbi as unknown as Array<Record<string, unknown>>;
    const out = jsonOf(await call({ hash, abi: jsonAbi })) as Out;
    expect(out.logs[0]!["source"]).toBe("abi");
    expect(out.logs[0]!.args?.["amount1In"]).toBe("1000000000000000000");
  });

  it("falls back to the built-in set when the user ABI event does not fit the log", async () => {
    mockTx([transferLog(token, 7n)]);
    // Same topic0 as ERC-20 Transfer but with the wrong shape (tokenId indexed): strict decode fails, builtin ERC-20 wins.
    const out = jsonOf(await call({ hash, abi: ["event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"] })) as Out;
    expect(out.logs[0]!["source"]).toBe("builtin");
    expect(out.logs[0]!.args?.["value"]).toBe("7");
  });

  it("uses index keys for unnamed event parameters", async () => {
    mockTx([swapLog(token)]);
    const out = jsonOf(await call({ hash, abi: ["event Swap(address indexed, uint256, uint256, uint256, uint256, address indexed)"] })) as Out;
    expect(out.logs[0]!["source"]).toBe("abi");
    expect(Object.keys(out.logs[0]!.args ?? {})).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect(out.logs[0]!.args?.["3"]).toBe("5");
  });

  it("filters by emitting address, case-insensitively", async () => {
    mockTx([transferLog(token, 1n), transferLog(other, 2n)]);
    const out = jsonOf(await call({ hash, address: token.toUpperCase().replace("0X", "0x") })) as Out & { filteredLogCount: number };
    expect(out.logCount).toBe(2);
    expect(out.filteredLogCount).toBe(1);
    expect(out.logs).toHaveLength(1);
    expect(String(out.logs[0]!["address"]).toLowerCase()).toBe(token);
    expect(out.logs[0]!.args?.["value"]).toBe("1");
  });

  it("rejects an invalid address filter", async () => {
    mockTx([]);
    expect(isError(await call({ hash, address: "0x123" }))).toBe(true);
  });

  it("reports undecoded logs with a hint, and omits them when includeUndecoded is false", async () => {
    const unknown: RpcLog = { address: token, topics: [("0x" + "ab".repeat(32)) as Hex, pad(from, { size: 32 })], data: "0x" + "00".repeat(64) as Hex };
    mockTx([unknown, transferLog(token, 1n)]);
    const out = jsonOf(await call({ hash })) as Out;
    expect(out.decodedCount).toBe(1);
    expect(out.undecodedCount).toBe(1);
    const u = out.logs.find((l) => l["decoded"] === false)!;
    expect(u["topic0"]).toBe("0x" + "ab".repeat(32));
    expect(u["topicCount"]).toBe(2);
    expect(u["dataLength"]).toBe(64);
    expect(String(u["hint"])).toMatch(/event fragment/i);

    const slim = jsonOf(await call({ hash, includeUndecoded: false })) as Out;
    expect(slim.undecodedCount).toBe(1);
    expect(slim.logs).toHaveLength(1);
  });

  it("decodes the top-level input when a function fragment matches the selector", async () => {
    const fnAbi = parseAbi(["function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)"]);
    const input = encodeFunctionData({ abi: fnAbi, functionName: "swapExactTokensForTokens", args: [1000000000000000000n, 5n, [token, other], to, 1900000000n] });
    mockTx([], { input });
    const out = jsonOf(await call({ hash, abi: ["function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)"] })) as Out;
    expect(out.input?.["functionName"]).toBe("swapExactTokensForTokens");
    expect(out.input?.["args"]).toEqual({ amountIn: "1000000000000000000", amountOutMin: "5", path: [token, other], to, deadline: "1900000000" });

    const noFn = jsonOf(await call({ hash })) as Out;
    expect(noFn.input?.["decoded"]).toBe(false);
    expect(String(noFn.input?.["hint"])).toMatch(/function fragment/);
  });

  it("notes an EntryPoint bundle and decodes its UserOperationEvent", async () => {
    const epAbi = parseAbi(["event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)"]);
    const opHash = ("0x" + "aa".repeat(32)) as Hex;
    mockTx(
      [
        {
          address: ENTRYPOINT_V07_ADDRESS,
          topics: encodeEventTopics({ abi: epAbi, eventName: "UserOperationEvent", args: { userOpHash: opHash, sender: from, paymaster: other } }) as Hex[],
          data: encodeAbiParameters([{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }], [3n, true, 99n, 77n]),
        },
      ],
      { to: ENTRYPOINT_V07_ADDRESS }
    );
    const out = jsonOf(await call({ hash })) as Out;
    expect(out.notes?.join(" ")).toMatch(/handleOps/);
    expect(out.logs[0]!["eventName"]).toBe("UserOperationEvent");
    expect(out.logs[0]!.args).toEqual({ userOpHash: opHash, sender: from, paymaster: other, nonce: "3", success: true, actualGasCost: "99", actualGasUsed: "77" });
  });

  it("caps output at 200 logs and reports truncated", async () => {
    mockTx(Array.from({ length: 205 }, (_, i) => transferLog(token, BigInt(i))));
    const out = jsonOf(await call({ hash })) as Out;
    expect(out.logCount).toBe(205);
    expect(out.logs).toHaveLength(200);
    expect(out.truncated).toBe(true);
  });

  it("names the bad fragment and how to fix it", async () => {
    mockTx([]);
    const res = await call({ hash, abi: ["event Swap(address indexed sender, uint999 nope"] });
    expect(isError(res)).toBe(true);
    expect(textOf(res)).toContain("event Swap(address indexed sender, uint999 nope");
    expect(textOf(res)).toMatch(/Write it as a Solidity declaration/);
  });

  it("rejects a JSON ABI item without a type", async () => {
    mockTx([]);
    const res = await call({ hash, abi: [{ name: "Foo" }] });
    expect(isError(res)).toBe(true);
    expect(textOf(res)).toMatch(/abi\[0\]/);
  });

  describe("general decoding", () => {
    const pingAbi = parseAbi(["event Pinged(address indexed who, uint256 amount)"]);
    const pingFn = parseAbi(["function ping(address who, uint256 amount)"]);
    const target = "0x5555555555555555555555555555555555555555";
    const impl = "0x6666666666666666666666666666666666666666";
    function pingLog(address: string): RpcLog {
      return {
        address,
        topics: encodeEventTopics({ abi: pingAbi, eventName: "Pinged", args: { who: from } }) as Hex[],
        data: encodeAbiParameters([{ type: "uint256" }], [42n]),
      };
    }
    const verifiedBody = (abi: unknown, extra: Record<string, unknown> = {}) => ({ is_verified: true, abi, ...extra });

    it("decodes with the verified ABI of the emitting contract", async () => {
      mockTx([pingLog(target)], { web: { [`/smart-contracts/${target}`]: verifiedBody(pingAbi) } });
      const out = jsonOf(await call({ hash })) as Out;
      expect(out.logs[0]!["source"]).toBe("verified");
      expect(out.logs[0]!["eventName"]).toBe("Pinged");
      expect(out.logs[0]!.args).toEqual({ who: from, amount: "42" });
      expect(out.lookups.verifiedAbis).toBe(1);
    });

    it("merges proxy implementation ABIs", async () => {
      mockTx([pingLog(target)], {
        web: {
          [`/smart-contracts/${target}`]: verifiedBody([], { implementations: [{ address_hash: impl, name: "Impl" }] }),
          [`/smart-contracts/${impl}`]: verifiedBody(pingAbi),
        },
      });
      const out = jsonOf(await call({ hash })) as Out;
      expect(out.logs[0]!["source"]).toBe("verified");
      expect(out.logs[0]!.args?.["amount"]).toBe("42");
    });

    it("fetches each distinct address once", async () => {
      mockTx([pingLog(target), pingLog(target), pingLog(target)], { web: { [`/smart-contracts/${target}`]: verifiedBody(pingAbi) } });
      const out = jsonOf(await call({ hash })) as Out;
      expect(out.decodedCount).toBe(3);
      expect(webCalls.filter((u) => u.includes("/smart-contracts/"))).toHaveLength(1);
    });

    it("re-decodes pepuscan's method_call locally and ignores its parameter values", async () => {
      mockTx([pingLog(target)], {
        web: {
          [`/transactions/${hash}/logs`]: {
            items: [{ index: 0, address: { hash: target }, decoded: { method_call: "Pinged(address indexed who, uint256 amount)", method_id: "0x", parameters: [{ name: "amount", type: "uint256", value: "999" }] } }],
            next_page_params: null,
          },
        },
      });
      const out = jsonOf(await call({ hash })) as Out;
      expect(out.logs[0]!["source"]).toBe("pepuscan");
      expect(out.logs[0]!.args).toEqual({ who: from, amount: "42" });
      expect(out.lookups.pepuscanLogs).toBe("ok");
    });

    it("falls back to the built-in set without an error when every lookup fails", async () => {
      mockTx([transferLog(token, 5n)]);
      const res = await call({ hash });
      expect(isError(res)).toBe(false);
      const out = jsonOf(res) as Out;
      expect(out.logs[0]!["source"]).toBe("builtin");
      expect(out.lookups.pepuscanLogs).toBe("failed");
    });

    it("names an unknown event from the signature database and infers the indexed position", async () => {
      mockTx([pingLog(target)], { web: { "event-signatures": { results: [{ text_signature: "Pinged(address,uint256)" }] } } });
      const out = jsonOf(await call({ hash })) as Out;
      const log = out.logs[0]!;
      expect(log["source"]).toBe("signature-db");
      expect(log["eventName"]).toBe("Pinged");
      expect(log.args?.["1"]).toBe("42");
      expect(out.lookups.signatureDb).toBe(1);
    });

    it("decodes uniquely when only one indexed layout fits", async () => {
      const flagAbi = parseAbi(["event Flagged(address indexed who, bool ok)"]);
      mockTx(
        [{ address: target, topics: encodeEventTopics({ abi: flagAbi, eventName: "Flagged", args: { who: from } }) as Hex[], data: encodeAbiParameters([{ type: "bool" }], [true]) }],
        { web: { "event-signatures": { results: [{ text_signature: "Flagged(address,bool)" }] } } }
      );
      const log = (jsonOf(await call({ hash })) as Out).logs[0]!;
      expect(log["source"]).toBe("signature-db");
      expect(log["ambiguous"]).toBeUndefined();
      expect(log.args).toEqual({ "0": from, "1": true });
    });

    it("flags ambiguous indexed layouts and returns the first that decodes", async () => {
      // Pinged(address,uint256) with one indexed topic decodes as {0} and as {1}: both 32-byte words fit either type.
      mockTx([pingLog(target)], { web: { "event-signatures": { results: [{ text_signature: "Pinged(address,uint256)" }] } } });
      const log = (jsonOf(await call({ hash })) as Out).logs[0]!;
      expect(log["ambiguous"]).toBe(true);
      expect(String(log["note"])).toMatch(/guessed/);
      expect(log.args?.["0"]).toBe(from);
    });

    it("lists candidate signatures when nothing decodes", async () => {
      mockTx([pingLog(target)], { web: { "event-signatures": { results: [{ text_signature: "Weird(string,string,string)" }] } } });
      const out = jsonOf(await call({ hash })) as Out;
      expect(out.undecodedCount).toBe(1);
      expect(out.logs[0]!["candidateSignatures"]).toEqual(["Weird(string,string,string)"]);
    });

    it("makes no lookups when offline is true", async () => {
      mockTx([transferLog(token, 5n), pingLog(target)], { input: "0xdeadbeef", web: {} });
      const out = jsonOf(await call({ hash, offline: true })) as Out;
      expect(webCalls).toHaveLength(0);
      expect(out.logs[0]!["source"]).toBe("builtin");
      expect(out.lookups).toEqual({ verifiedAbis: 0, pepuscanLogs: "skipped", signatureDb: 0 });
      expect(out.undecodedCount).toBe(1);
    });

    it("decodes the input with the verified ABI of tx.to", async () => {
      const input = encodeFunctionData({ abi: pingFn, functionName: "ping", args: [from, 7n] });
      mockTx([], { to: target, input, web: { [`/smart-contracts/${target}`]: verifiedBody(pingFn) } });
      const out = jsonOf(await call({ hash })) as Out;
      expect(out.input?.["source"]).toBe("verified");
      expect(out.input?.["args"]).toEqual({ who: from, amount: "7" });
    });

    it("decodes the input from pepuscan's method_call", async () => {
      const input = encodeFunctionData({ abi: pingFn, functionName: "ping", args: [from, 8n] });
      mockTx([], { to: target, input, web: { [`/transactions/${hash}`]: { decoded_input: { method_call: "ping(address who, uint256 amount)", method_id: "0x", parameters: [] } } } });
      const out = jsonOf(await call({ hash })) as Out;
      expect(out.input?.["source"]).toBe("pepuscan");
      expect(out.input?.["args"]).toEqual({ who: from, amount: "8" });
    });

    it("decodes the input from a 4byte function signature", async () => {
      const input = encodeFunctionData({ abi: pingFn, functionName: "ping", args: [from, 9n] });
      mockTx([], { to: target, input, web: { "/signatures/": { results: [{ text_signature: "ping(address,uint256)" }] } } });
      const out = jsonOf(await call({ hash })) as Out;
      expect(out.input?.["source"]).toBe("signature-db");
      expect(out.input?.["functionName"]).toBe("ping");
      expect(out.input?.["args"]).toEqual({ "0": from, "1": "9" });
    });
  });
});
