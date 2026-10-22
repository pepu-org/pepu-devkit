import { afterEach, describe, expect, it, vi } from "vitest";
import { PRIVY_ENV, PRIVY_ENV_ALIASES } from "../src/privy/requirements.js";

vi.mock("@privy-io/node", () => ({
  PrivyClient: class {},
  isEmbeddedWalletLinkedAccount: () => false,
}));

const { privyEnvVar, readPrivyServerEnv } = await import("../src/privy/server.js");

const names = [
  ...Object.values(PRIVY_ENV),
  ...Object.values(PRIVY_ENV_ALIASES).flat(),
] as string[];

describe("single source of Privy env names", () => {
  afterEach(() => {
    for (const n of names) delete process.env[n];
  });

  it("reads the canonical name first, then the alias", () => {
    process.env.PRIVY_KEY_QUORUM_ID = "alias";
    expect(privyEnvVar("keyQuorumId")).toBe("alias");
    process.env[PRIVY_ENV.keyQuorumId] = "canonical";
    expect(privyEnvVar("keyQuorumId")).toBe("canonical");
  });

  it("treats blank values as unset", () => {
    process.env[PRIVY_ENV.keyQuorumId] = "   ";
    expect(privyEnvVar("keyQuorumId")).toBeUndefined();
  });

  it("readPrivyServerEnv accepts PRIVY_APP_ID and returns the quorum id", () => {
    process.env.PRIVY_APP_ID = "app";
    process.env[PRIVY_ENV.appSecret] = "secret";
    process.env[PRIVY_ENV.keyQuorumId] = "q1";
    expect(readPrivyServerEnv()).toMatchObject({ appId: "app", appSecret: "secret", keyQuorumId: "q1" });
  });

  it("missing-env errors name variables but never leak a value", () => {
    process.env[PRIVY_ENV.appSecret] = "sk_live_supersecret";
    try {
      readPrivyServerEnv();
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain(PRIVY_ENV.appId);
      expect((e as Error).message).not.toContain("sk_live_supersecret");
    }
  });
});
