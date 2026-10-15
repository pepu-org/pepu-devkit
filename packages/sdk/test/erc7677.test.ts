import { describe, expect, it } from "vitest";
import {
  buildPaymasterContext,
  buildPaymasterDataRequest,
  buildPaymasterStubDataRequest,
} from "../src/index.js";

const userOperation = {
  sender: "0x1111111111111111111111111111111111111111",
  callData: "0x1234",
} as const;

describe("buildPaymasterContext", () => {
  it("returns {} for no input and drops undefined entries", () => {
    expect(buildPaymasterContext()).toEqual({});
    expect(buildPaymasterContext({ a: 1, b: undefined, c: "x" })).toEqual({ a: 1, c: "x" });
  });

  it("rejects values that are not JSON-serializable", () => {
    expect(() => buildPaymasterContext({ big: 1n })).toThrow(/bigint/);
    expect(() => buildPaymasterContext({ fn: () => 1 })).toThrow(/function/);
  });
});

describe("paymaster request builders", () => {
  it("builds a stub-data request with PEPU defaults (EntryPoint v0.7, chain 97741)", () => {
    const req = buildPaymasterStubDataRequest({ userOperation });
    expect(req.method).toBe("pm_getPaymasterStubData");
    expect(req.jsonrpc).toBe("2.0");
    expect(req.params[1]).toBe("0x0000000071727De22E5E9d8BAf0edAc6f37da032");
    expect(req.params[2]).toBe("0x17dcd");
    expect(req.params).toHaveLength(3);
  });

  it("builds a paymaster-data request and includes context when given", () => {
    const req = buildPaymasterDataRequest({
      userOperation,
      context: buildPaymasterContext({ k: "v" }),
      id: 7,
    });
    expect(req.method).toBe("pm_getPaymasterData");
    expect(req.id).toBe(7);
    expect(req.params[3]).toEqual({ k: "v" });
  });
});
