import { describe, expect, it, vi } from "vitest";
import { PEPU_PRIVY_REQUIREMENTS, PRIVY_ENV, checkPrivyDashboardConfig, privyDashboardChecker } from "../src/privy/config.js";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("PEPU_PRIVY_REQUIREMENTS", () => {
  it("has unique ids, a fix and a docs url on every row", () => {
    const ids = PEPU_PRIVY_REQUIREMENTS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of PEPU_PRIVY_REQUIREMENTS) {
      expect(r.fix.length).toBeGreaterThan(10);
      expect(r.docsUrl).toMatch(/^https:\/\//);
      expect(r.pillars.length).toBeGreaterThan(0);
    }
  });

  it("only dashboard rows carry a check", () => {
    for (const r of PEPU_PRIVY_REQUIREMENTS) expect(Boolean(r.check)).toBe(r.where === "dashboard" ? r.check !== undefined : false);
  });

  it("exposes the env variable names", () => {
    expect(PRIVY_ENV).toEqual({
      appId: "NEXT_PUBLIC_PRIVY_APP_ID",
      appSecret: "PRIVY_APP_SECRET",
      authorizationKey: "PRIVY_AUTHORIZATION_KEY",
      keyQuorumId: "NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID",
    });
  });
});

describe("checkPrivyDashboardConfig", () => {
  it("passes when the origin is allowed and login methods exist", async () => {
    const fetchFn = vi.fn(async () =>
      json({ allowed_domains: ["http://localhost:3001"], login_methods: ["google_oauth"], embedded_wallet_config: { ethereum: {} } }),
    ) as unknown as typeof fetch;
    const r = await checkPrivyDashboardConfig({ appId: "cl123", origin: "http://localhost:3001/", fetch: fetchFn });
    expect(r.ok).toBe(true);
    expect(r.items.find((i) => i.id === "allowed-origins")?.ok).toBe(true);
    expect(r.items.find((i) => i.id === "login-methods")?.ok).toBe(true);
  });

  it("flags a port mismatch as a definite failure with a fix", async () => {
    const fetchFn = (async () => json({ allowed_domains: ["http://localhost:3000"] })) as unknown as typeof fetch;
    const r = await checkPrivyDashboardConfig({ appId: "cl123", origin: "http://localhost:3001", fetch: fetchFn });
    const item = r.items.find((i) => i.id === "allowed-origins");
    expect(item?.ok).toBe(false);
    expect(item?.fix).toMatch(/port/i);
    expect(r.ok).toBe(false);
  });

  it("reports unknown, not failure, when fields are missing", async () => {
    const fetchFn = (async () => json({})) as unknown as typeof fetch;
    const r = await checkPrivyDashboardConfig({ appId: "cl123", origin: "http://localhost:3001", fetch: fetchFn });
    expect(r.ok).toBe(true);
    expect(r.items.every((i) => i.ok === "unknown")).toBe(true);
  });

  it("degrades to unknown on HTTP errors, network errors and an empty app id, never throwing", async () => {
    const bad = (async () => json({ error: "nope" }, 400)) as unknown as typeof fetch;
    const boom = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    for (const args of [
      { appId: "cl123", fetch: bad },
      { appId: "cl123", fetch: boom },
      { appId: "  ", fetch: bad },
    ]) {
      const r = await checkPrivyDashboardConfig(args);
      expect(r.ok).toBe(true);
      expect(r.items.length).toBeGreaterThan(0);
      expect(r.items.every((i) => i.ok === "unknown")).toBe(true);
    }
  });

  it("sends the app id header and url-encodes the id", async () => {
    const fetchFn = vi.fn(async () => json({}));
    await checkPrivyDashboardConfig({ appId: "a/b", fetch: fetchFn as unknown as typeof fetch });
    const call = fetchFn.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(call[0]).toBe("https://auth.privy.io/api/v1/apps/a%2Fb");
    expect(call[1].headers["privy-app-id"]).toBe("a/b");
  });
});

describe("privyDashboardChecker", () => {
  const mk = (body: unknown) => (async () => json(body)) as unknown as typeof fetch;
  it("maps results to doctor statuses and handles unknown and non-dashboard keys", async () => {
    const checks = await privyDashboardChecker({
      appId: "cl1",
      origin: "http://localhost:3001",
      appSecret: "SECRET-VALUE",
      fetch: mk({ allowed_domains: ["http://localhost:3000"], login_methods: ["email"] }),
      requirementKeys: ["login-methods", "login-methods.google", "allowed-origins", "authorization-key-quorum", "embedded-wallets", "nope"],
    });
    const by = Object.fromEntries(checks.map((c) => [c.id, c.status]));
    expect(by).toEqual({
      "privy.login-methods": "pass",
      "privy.login-methods.google": "fail",
      "privy.allowed-origins": "fail",
      "privy.authorization-key-quorum": "skip",
      "privy.embedded-wallets": "warn",
      "privy.nope": "fail",
    });
    expect(JSON.stringify(checks)).not.toContain("SECRET-VALUE");
    expect(JSON.stringify(checks)).not.toContain("auth.privy.io");
  });
  it("warns instead of failing when Privy is unreachable", async () => {
    const boom = (async () => {
      throw new Error("x");
    }) as unknown as typeof fetch;
    const checks = await privyDashboardChecker({ appId: "cl1", fetch: boom, requirementKeys: ["login-methods"] });
    expect(checks[0]?.status).toBe("warn");
  });
});
