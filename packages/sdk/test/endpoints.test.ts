import { describe, expect, it } from "vitest";
import { pepuMainnet } from "../src/chains.js";
import {
  PEPU_ENV,
  PEPU_HOSTED,
  PEPU_PUBLIC_ENV,
  hostedFreeTierUrl,
  isHostedSponsorshipLive,
  paymasterBaseOf,
  resolvePepuEndpoints,
} from "../src/endpoints.js";
import { hostedErc7677Url } from "../src/paymaster/api.js";
import { PepuConfigError } from "../src/errors.js";

describe("endpoints", () => {
  it("hosted URLs are the pepeunchained.com services; the full ERC-7677 URL needs a token", () => {
    expect(PEPU_HOSTED).toEqual({
      bundlerUrl: "https://bundler.pepeunchained.com",
      paymasterBaseUrl: "https://paymaster.pepeunchained.com",
      paymasterUrl: null,
    });
    expect(isHostedSponsorshipLive()).toBe(true);
  });

  it("builds the hosted ERC-7677 and free-tier URLs", () => {
    expect(hostedErc7677Url("ppt_abc")).toBe("https://paymaster.pepeunchained.com/v2/paymaster/ppt_abc");
    expect(hostedFreeTierUrl()).toBe("https://paymaster.pepeunchained.com/v2/free-tier");
    expect(() => hostedErc7677Url(" ")).toThrow(PepuConfigError);
  });

  it("reduces an ERC-7677 URL to the service base", () => {
    expect(paymasterBaseOf("https://pm.example/v2/paymaster/ppt_x")).toBe("https://pm.example");
    expect(paymasterBaseOf("https://pm.example/paymaster/ppt_x/")).toBe("https://pm.example");
    expect(paymasterBaseOf("https://pm.example/")).toBe("https://pm.example");
  });

  it("env var names", () => {
    expect(PEPU_ENV).toEqual({
      bundlerUrl: "PEPU_BUNDLER_URL",
      paymasterUrl: "PEPU_PAYMASTER_URL",
      rpcUrl: "PEPU_RPC_URL",
    });
    expect(PEPU_PUBLIC_ENV.bundlerUrl).toBe("NEXT_PUBLIC_PEPU_BUNDLER_URL");
  });

  it("defaults: PEPU rpc, hosted bundler and paymaster base, no token URL, hosted-default source", () => {
    expect(resolvePepuEndpoints({ env: {} })).toEqual({
      rpcUrl: pepuMainnet.rpcUrls.default.http[0],
      bundlerUrl: "https://bundler.pepeunchained.com",
      paymasterUrl: null,
      paymasterBaseUrl: "https://paymaster.pepeunchained.com",
      source: "hosted-default",
    });
  });

  it("a configured ERC-7677 URL sets paymasterUrl and derives the base", () => {
    const r = resolvePepuEndpoints({ env: { PEPU_PAYMASTER_URL: "https://pm.example/v2/paymaster/ppt_x" } });
    expect(r.paymasterUrl).toBe("https://pm.example/v2/paymaster/ppt_x");
    expect(r.paymasterBaseUrl).toBe("https://pm.example");
    expect(r.source).toBe("env");
  });

  it("reads env, server variable before NEXT_PUBLIC_", () => {
    const out = resolvePepuEndpoints({
      env: {
        PEPU_BUNDLER_URL: "https://b.example",
        NEXT_PUBLIC_PEPU_BUNDLER_URL: "https://public-b.example",
        NEXT_PUBLIC_PEPU_PAYMASTER_URL: "https://p.example",
        PEPU_RPC_URL: "https://rpc.example",
      },
    });
    expect(out).toMatchObject({
      bundlerUrl: "https://b.example",
      paymasterUrl: "https://p.example",
      rpcUrl: "https://rpc.example",
      source: "env",
    });
  });

  it("explicit options beat env", () => {
    const out = resolvePepuEndpoints({
      bundlerUrl: "https://x.example",
      env: { PEPU_BUNDLER_URL: "https://b.example" },
    });
    expect(out.bundlerUrl).toBe("https://x.example");
    expect(out.source).toBe("explicit");
  });

  it("treats blank values as unset", () => {
    expect(resolvePepuEndpoints({ env: { PEPU_BUNDLER_URL: "  " } }).bundlerUrl).toBe(PEPU_HOSTED.bundlerUrl);
  });

  it("rejects bad URLs naming the variable but not the value", () => {
    let err: unknown;
    try {
      resolvePepuEndpoints({ env: { PEPU_BUNDLER_URL: "not a url secret-token" } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PepuConfigError);
    expect((err as PepuConfigError).code).toBe("CONFIG_BAD_URL");
    expect((err as PepuConfigError).message).toContain("PEPU_BUNDLER_URL");
    expect((err as PepuConfigError).message).not.toContain("secret-token");
    expect(() => resolvePepuEndpoints({ paymasterUrl: "ftp://x.example", env: {} })).toThrow(PepuConfigError);
  });

  it("falls back to process.env when env is omitted", () => {
    process.env["PEPU_PAYMASTER_URL"] = "https://from-process.example";
    try {
      expect(resolvePepuEndpoints().paymasterUrl).toBe("https://from-process.example");
    } finally {
      delete process.env["PEPU_PAYMASTER_URL"];
    }
  });
});
