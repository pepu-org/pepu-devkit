import { afterEach, describe, expect, it, vi } from "vitest";
import { PepuConfigError } from "../src/errors.js";
import { assertServerOnly } from "../src/internal/assert-server.js";

afterEach(() => vi.unstubAllGlobals());

describe("assertServerOnly", () => {
  it("passes on the server", () => {
    expect(() => assertServerOnly("@pepu-chain/sdk/server")).not.toThrow();
  });

  it("throws a typed error when `window` exists", () => {
    vi.stubGlobal("window", {});
    let err: unknown;
    try {
      assertServerOnly("@pepu-chain/sdk/server");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PepuConfigError);
    expect((err as PepuConfigError).code).toBe("CONFIG_SERVER_ONLY");
    expect((err as PepuConfigError).message).toContain("@pepu-chain/sdk/server");
  });

  it("is enforced when a server entry is imported", async () => {
    vi.stubGlobal("window", {});
    vi.resetModules();
    await expect(import("../src/session/server.js")).rejects.toThrow(/server-only/);
    await expect(import("../src/server.js")).rejects.toThrow(/server-only/);
  });
});
