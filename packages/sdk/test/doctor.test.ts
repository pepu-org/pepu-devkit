import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  TEMPLATE_REQUIREMENTS,
  checkChainRpc,
  checkPepuEnv,
  checkPrivyAppIdFormat,
  checkSponsorshipEndpoints,
  generatePrivyAuthorizationKey,
  runDoctor,
  type PrivyDashboardChecker,
} from "../src/doctor.js";

const APP_ID = "clabcd1234efgh5678ijkl90m";
const SECRET_VALUE = "super-secret-value-abc123XYZ";
const ADDR = "0x261eA5971B93237a56990206A46Bc80318e4d078";

function jsonFetch(map: (url: string, body: { method: string }) => unknown): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as { method: string }) : { method: "" };
    const out = map(String(url), body);
    if (out instanceof Error) throw out;
    return new Response(JSON.stringify(out), { status: 200 });
  }) as typeof fetch;
}

describe("TEMPLATE_REQUIREMENTS", () => {
  it("covers all six templates and matches each .env.example variables", () => {
    const names = ["consumer-app", "game-app", "token-gated-app", "nft-mint", "sponsored-demo", "sponsored-session-app"];
    expect(Object.keys(TEMPLATE_REQUIREMENTS).sort()).toEqual([...names].sort());
    for (const n of names) {
      const file = resolve(__dirname, "../../../templates", n, ".env.example");
      const vars = new Set(
        readFileSync(file, "utf8")
          .split("\n")
          .map((l) => /^([A-Z][A-Z0-9_]+)=/.exec(l)?.[1])
          .filter((v): v is string => v !== undefined),
      );
      const r = TEMPLATE_REQUIREMENTS[n]!;
      for (const k of [...r.requiredEnv, ...r.optionalEnv]) expect(vars.has(k), `${n} ${k}`).toBe(true);
      for (const v of vars) expect([...r.requiredEnv, ...r.optionalEnv], `${n} ${v}`).toContain(v);
      expect(r.privyDashboard.length).toBeGreaterThan(0);
    }
  });
});

describe("checkPepuEnv", () => {
  it("passes a complete game-app env", () => {
    const r = checkPepuEnv({
      template: "game-app",
      env: {
        NEXT_PUBLIC_PRIVY_APP_ID: APP_ID,
        PRIVY_APP_SECRET: SECRET_VALUE,
        NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID: "quorum123",
        PRIVY_AUTHORIZATION_KEY: "MIGHAgEAMBMG",
        NEXT_PUBLIC_GAME_CONTRACT_ADDRESS: ADDR,
      },
    });
    expect(r.ok).toBe(true);
  });

  it("flags missing, placeholder and malformed", () => {
    const r = checkPepuEnv({
      template: "nft-mint",
      env: { NEXT_PUBLIC_PRIVY_APP_ID: "your-app-id", PRIVY_APP_SECRET: "", NEXT_PUBLIC_NFT_CONTRACT_ADDRESS: "0x123" },
    });
    const by = Object.fromEntries(r.items.map((i) => [i.key, i.status]));
    expect(by).toMatchObject({
      NEXT_PUBLIC_PRIVY_APP_ID: "placeholder",
      PRIVY_APP_SECRET: "missing",
      NEXT_PUBLIC_NFT_CONTRACT_ADDRESS: "malformed",
    });
    expect(r.ok).toBe(false);
  });

  it("token-gated-app needs at least one gate address", () => {
    const base = { NEXT_PUBLIC_PRIVY_APP_ID: APP_ID, PRIVY_APP_SECRET: SECRET_VALUE };
    expect(checkPepuEnv({ template: "token-gated-app", env: base }).ok).toBe(false);
    expect(checkPepuEnv({ template: "token-gated-app", env: { ...base, NEXT_PUBLIC_GATE_ERC20_ADDRESS: ADDR } }).ok).toBe(true);
  });

  it("sponsored-session-app requires bundler and paymaster URLs", () => {
    const r = checkPepuEnv({
      template: "sponsored-session-app",
      env: { NEXT_PUBLIC_PRIVY_APP_ID: APP_ID, PRIVY_APP_SECRET: SECRET_VALUE, PEPU_BUNDLER_URL: "not a url" },
    });
    const by = Object.fromEntries(r.items.map((i) => [i.key, i.status]));
    expect(by.PEPU_BUNDLER_URL).toBe("malformed");
    expect(by.PEPU_PAYMASTER_URL).toBe("missing");
  });

  it("reports presence and length only, never values", () => {
    const env = {
      NEXT_PUBLIC_PRIVY_APP_ID: APP_ID,
      PRIVY_APP_SECRET: SECRET_VALUE,
      PRIVY_AUTHORIZATION_KEY: "AUTHKEYSECRET-zzz",
      NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID: "quorum-zz-id",
      NEXT_PUBLIC_GAME_CONTRACT_ADDRESS: "bad-" + SECRET_VALUE,
    };
    const r = checkPepuEnv({ template: "game-app", env });
    const dump = JSON.stringify(r);
    for (const v of Object.values(env)) expect(dump).not.toContain(v);
    expect(r.items.find((i) => i.key === "PRIVY_APP_SECRET")).toMatchObject({
      length: SECRET_VALUE.length,
      secret: true,
    });
  });
});

describe("network checks", () => {
  it("chain rpc passes on 97741 and fails on a wrong chain", async () => {
    const ok = await checkChainRpc({ fetch: jsonFetch(() => ({ result: "0x17dcd" })) });
    expect(ok.status).toBe("pass");
    const bad = await checkChainRpc({ fetch: jsonFetch(() => ({ result: "0x1" })) });
    expect(bad.status).toBe("fail");
    const down = await checkChainRpc({ fetch: jsonFetch(() => new Error("boom")) });
    expect(down.status).toBe("fail");
  });

  it("sponsorship endpoints default to the hosted bundler and paymaster base", async () => {
    const urls: string[] = [];
    const out = await checkSponsorshipEndpoints({
      env: {},
      fetch: jsonFetch((u, b) => {
        urls.push(u);
        return b.method === "eth_supportedEntryPoints" ? { result: ["0xabc"] } : {};
      }),
    });
    expect(out.map((c) => c.status)).toEqual(["pass", "pass"]);
    expect(urls).toContain("https://bundler.pepeunchained.com");
    expect(urls).toContain("https://paymaster.pepeunchained.com/health");
  });

  it("sponsorship endpoints never leak URLs (paymaster keys)", async () => {
    const env = {
      PEPU_BUNDLER_URL: "http://bundler.local:4337",
      PEPU_PAYMASTER_URL: "http://pm.local/paymaster/SECRETKEY123",
    };
    const up = await checkSponsorshipEndpoints({
      env,
      fetch: jsonFetch((_u, b) => (b.method === "eth_supportedEntryPoints" ? { result: ["0xabc"] } : {})),
    });
    expect(up.map((c) => c.status)).toEqual(["pass", "pass"]);
    const down = await checkSponsorshipEndpoints({ env, fetch: jsonFetch(() => new Error("SECRETKEY123 refused")) });
    expect(down.map((c) => c.status)).toEqual(["fail", "fail"]);
    expect(JSON.stringify([up, down])).not.toMatch(/SECRETKEY123|bundler\.local|pm\.local/);
  });

  it("bad URL surfaces a config failure naming the variable only", async () => {
    const out = await checkSponsorshipEndpoints({ env: { PEPU_BUNDLER_URL: "ftp://x/SECRETKEY123" } });
    expect(out[0]?.status).toBe("fail");
    expect(JSON.stringify(out)).not.toContain("SECRETKEY123");
  });
});

describe("checkPrivyAppIdFormat", () => {
  it("validates format without echoing the value", () => {
    expect(checkPrivyAppIdFormat(APP_ID).status).toBe("pass");
    expect(checkPrivyAppIdFormat(undefined).status).toBe("fail");
    const bad = checkPrivyAppIdFormat(SECRET_VALUE);
    expect(bad.status).toBe("fail");
    expect(JSON.stringify(bad)).not.toContain(SECRET_VALUE);
  });
});

describe("runDoctor", () => {
  const env = {
    NEXT_PUBLIC_PRIVY_APP_ID: APP_ID,
    PRIVY_APP_SECRET: SECRET_VALUE,
    PEPU_BUNDLER_URL: "http://bundler.local:4337",
    PEPU_PAYMASTER_URL: "http://pm.local/paymaster/k",
  };
  const f = jsonFetch((_u, b) => {
    if (b.method === "eth_chainId") return { result: "0x17dcd" };
    if (b.method === "eth_supportedEntryPoints") return { result: ["0xabc"] };
    return {};
  });

  it("injects the privy dashboard checker with the template's requirement keys", async () => {
    const checker = vi.fn(async (_i: Parameters<PrivyDashboardChecker>[0]) => [{ id: "privy.dashboard.x", status: "pass" as const, message: "ok" }]);
    const rep = await runDoctor({ env, template: "sponsored-session-app", fetch: f, checkPrivyDashboard: checker });
    expect(checker).toHaveBeenCalledOnce();
    expect(checker.mock.calls[0]![0].requirementKeys).toEqual(TEMPLATE_REQUIREMENTS["sponsored-session-app"]!.privyDashboard);
    expect(rep.checks.some((c) => c.id === "privy.dashboard.x")).toBe(true);
    expect(rep.ok).toBe(true);
    expect(JSON.stringify(rep)).not.toContain(SECRET_VALUE);
  });

  it("passes origin to the dashboard checker, and omits it when not given", async () => {
    const checker = vi.fn(async (_i: Parameters<PrivyDashboardChecker>[0]) => []);
    await runDoctor({ env, template: "consumer-app", fetch: f, checkPrivyDashboard: checker, origin: "http://localhost:3000" });
    expect(checker.mock.calls[0]![0].origin).toBe("http://localhost:3000");
    await runDoctor({ env, template: "consumer-app", fetch: f, checkPrivyDashboard: checker });
    expect("origin" in checker.mock.calls[1]![0]).toBe(false);
  });

  it("offline skips network and reports missing env as failures", async () => {
    const rep = await runDoctor({ env: {}, template: "consumer-app", offline: true });
    expect(rep.ok).toBe(false);
    expect(rep.checks.find((c) => c.id === "network")?.status).toBe("skip");
  });

  it("unknown template fails", async () => {
    const rep = await runDoctor({ env, template: "nope", offline: true });
    expect(rep.checks.find((c) => c.id === "template")?.status).toBe("fail");
  });
});

describe("generatePrivyAuthorizationKey", () => {
  it("returns base64 SPKI and PKCS8 P-256 keys that import", async () => {
    const { publicKey, privateKey } = await generatePrivyAuthorizationKey();
    const dec = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    expect(publicKey).not.toContain("BEGIN");
    expect(privateKey).not.toContain("BEGIN");
    await crypto.subtle.importKey("spki", dec(publicKey), { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
    await crypto.subtle.importKey("pkcs8", dec(privateKey), { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  });
});
