import type { PrivyClient } from "@privy-io/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PepuAuthError, PepuConfigError } from "../src/errors.js";
import {
  createEnsureWalletRoute,
  createPrivyServer,
  findDelegatedEthereumWallet,
  findEmbeddedEthereumWallet,
  readPrivyServerEnv,
  requireUser,
  verifyRequestUser,
} from "../src/privy/server.js";
import type { PrivyUser } from "../src/privy/server.js";

const ADDR = "0x2222222222222222222222222222222222222222";
const ADDR2 = "0x3333333333333333333333333333333333333333";

const embedded = (address: string, delegated = false, chain = "ethereum") =>
  ({ type: "wallet", wallet_client_type: "privy", connector_type: "embedded", chain_type: chain, address, delegated }) as never;
const google = { type: "google_oauth", subject: "s", email: "a@b.c", name: "n" } as never;

interface FakeOpts {
  users?: PrivyUser[];
  verify?: (t: string) => Promise<{ user_id: string }>;
  create?: () => Promise<{ address: string }>;
}
function fakePrivy(o: FakeOpts = {}) {
  const users = [...(o.users ?? [{ linked_accounts: [google] }])];
  const get = vi.fn(async () => {
    const next = users.length > 1 ? users.shift() : users[0];
    return next as PrivyUser;
  });
  const create = vi.fn(o.create ?? (async () => ({ address: ADDR })));
  const verify = vi.fn(o.verify ?? (async () => ({ user_id: "did:privy:u1" })));
  const client = {
    users: () => ({ _get: get }),
    wallets: () => ({ create }),
    utils: () => ({ auth: () => ({ verifyAccessToken: verify }) }),
  } as unknown as PrivyClient;
  return { client, get, create, verify };
}
const req = (token?: string): Request =>
  new Request("http://localhost/api/wallet/ensure", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
const errBody = async (r: Response) => ((await r.json()) as { error: { code: string; message: string; hint: string } }).error;

afterEach(() => vi.unstubAllEnvs());

describe("readPrivyServerEnv / createPrivyServer", () => {
  it("lists every missing variable by name only", () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "");
    vi.stubEnv("PRIVY_APP_SECRET", "");
    try {
      readPrivyServerEnv();
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PepuConfigError);
      expect((e as Error).message).toContain("NEXT_PUBLIC_PRIVY_APP_ID");
      expect((e as Error).message).toContain("PRIVY_APP_SECRET");
      expect((e as PepuConfigError).code).toBe("CONFIG_MISSING_ENV");
    }
  });

  it("never echoes a secret value in the error", () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "");
    try {
      readPrivyServerEnv({ appSecret: "super-secret-value-xyz" });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain("super-secret-value-xyz");
      expect(JSON.stringify((e as PepuConfigError).details)).not.toContain("super-secret-value-xyz");
    }
  });

  it("reads env, keeps the authorization key optional, and caches the client", () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "app1");
    vi.stubEnv("PRIVY_APP_SECRET", "sec1");
    vi.stubEnv("PRIVY_AUTHORIZATION_KEY", "");
    expect(readPrivyServerEnv()).toEqual({ appId: "app1", appSecret: "sec1" });
    expect(createPrivyServer()).toBe(createPrivyServer());
    expect(createPrivyServer({ appId: "other", appSecret: "sec2" })).not.toBe(createPrivyServer());
  });
});

describe("verifyRequestUser", () => {
  it("returns the user id and claims for a valid token", async () => {
    const { client, verify } = fakePrivy();
    const r = await verifyRequestUser(req("good"), { privy: client });
    expect(r.userId).toBe("did:privy:u1");
    expect(verify).toHaveBeenCalledWith("good");
  });

  it("throws PepuAuthError (401) for a missing header", async () => {
    const { client, verify } = fakePrivy();
    const e = await verifyRequestUser(req(), { privy: client }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PepuAuthError);
    expect((e as PepuAuthError).status).toBe(401);
    expect(verify).not.toHaveBeenCalled();
  });

  it("throws PepuAuthError and redacts the token from the reason", async () => {
    const token = "eyJ.SECRET.token";
    const { client } = fakePrivy({
      verify: async () => {
        throw new Error(`bad signature for ${token}`);
      },
    });
    const e = (await verifyRequestUser(req(token), { privy: client }).catch((x: unknown) => x)) as PepuAuthError;
    expect(e).toBeInstanceOf(PepuAuthError);
    expect(e.message).not.toContain(token);
    expect(JSON.stringify(e.details)).not.toContain(token);
  });
});

describe("find wallets", () => {
  it("finds the embedded ethereum wallet and ignores other chains and accounts", () => {
    const user: PrivyUser = { linked_accounts: [google, embedded("SOL", false, "solana"), embedded(ADDR)] };
    expect(findEmbeddedEthereumWallet(user)?.address).toBe(ADDR);
    expect(findEmbeddedEthereumWallet({ linked_accounts: [google] })).toBeNull();
  });

  it("finds only a delegated wallet as delegated", () => {
    expect(findDelegatedEthereumWallet({ linked_accounts: [embedded(ADDR, false)] })).toBeNull();
    expect(findDelegatedEthereumWallet({ linked_accounts: [embedded(ADDR, false), embedded(ADDR2, true)] })?.address).toBe(ADDR2);
  });
});

describe("requireUser", () => {
  it("returns the user and address", async () => {
    const { client } = fakePrivy({ users: [{ linked_accounts: [embedded(ADDR)] }] });
    const r = await requireUser(req("t"), { privy: client });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.user.userId).toBe("did:privy:u1");
      expect(r.user.address).toBe(ADDR);
    }
  });

  it("returns address null when no wallet exists yet", async () => {
    const { client } = fakePrivy();
    const r = await requireUser(req("t"), { privy: client });
    expect(r.ok && r.user.address).toBeNull();
  });

  it("returns a 401 response with the error body for a bad token", async () => {
    const { client } = fakePrivy();
    const r = await requireUser(req(), { privy: client });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(401);
      expect((await errBody(r.response)).code).toBe("AUTH_INVALID_TOKEN");
    }
  });

  it("returns a 500 CONFIG_MISSING_ENV response when Privy is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "");
    vi.stubEnv("PRIVY_APP_SECRET", "");
    const r = await requireUser(req("t"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(500);
      expect((await errBody(r.response)).code).toBe("CONFIG_MISSING_ENV");
    }
  });

  it("returns 502 when the user lookup fails", async () => {
    const { client } = fakePrivy();
    (client as unknown as { users: () => unknown }).users = () => ({
      _get: async () => {
        throw new Error("privy down");
      },
    });
    const r = await requireUser(req("t"), { privy: client });
    expect(!r.ok && r.response.status).toBe(502);
  });
});

describe("createEnsureWalletRoute", () => {
  it("creates a wallet owned by the verified user id", async () => {
    const { client, create } = fakePrivy();
    const onCreated = vi.fn(async () => {});
    const { POST } = createEnsureWalletRoute({ privy: client, onCreated });
    const res = await POST(req("t"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ address: ADDR, created: true });
    expect(create).toHaveBeenCalledWith({ chain_type: "ethereum", owner: { user_id: "did:privy:u1" } });
    expect(onCreated).toHaveBeenCalledWith({ userId: "did:privy:u1", address: ADDR });
  });

  it("is idempotent: returns an existing wallet without creating", async () => {
    const { client, create } = fakePrivy({ users: [{ linked_accounts: [embedded(ADDR)] }] });
    const res = await createEnsureWalletRoute({ privy: client }).POST(req("t"));
    expect(await res.json()).toEqual({ address: ADDR, created: false });
    expect(create).not.toHaveBeenCalled();
  });

  it("re-checks after a failed create and succeeds if a racing request won", async () => {
    const { client, create } = fakePrivy({
      users: [{ linked_accounts: [google] }, { linked_accounts: [embedded(ADDR2)] }],
      create: async () => {
        throw new Error("already has a wallet");
      },
    });
    const res = await createEnsureWalletRoute({ privy: client }).POST(req("t"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ address: ADDR2, created: false });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("returns a 502 error body when create fails and no wallet exists", async () => {
    const { client } = fakePrivy({
      create: async () => {
        throw new Error("boom");
      },
    });
    const res = await createEnsureWalletRoute({ privy: client }).POST(req("t"));
    expect(res.status).toBe(502);
    const e = await errBody(res);
    expect(e.code).toBe("WALLET_NOT_PROVISIONED");
    expect(e.hint.length).toBeGreaterThan(0);
  });

  it("never reads a user id from the body or query", async () => {
    const { client, create } = fakePrivy();
    const request = new Request("http://localhost/api/wallet/ensure?user_id=evil", {
      method: "POST",
      headers: { authorization: "Bearer t", "content-type": "application/json" },
      body: JSON.stringify({ userId: "evil", user_id: "evil" }),
    });
    await createEnsureWalletRoute({ privy: client }).POST(request);
    expect(create).toHaveBeenCalledWith({ chain_type: "ethereum", owner: { user_id: "did:privy:u1" } });
  });

  it("still succeeds when onCreated throws", async () => {
    const { client } = fakePrivy();
    const res = await createEnsureWalletRoute({
      privy: client,
      onCreated: async () => {
        throw new Error("hook");
      },
    }).POST(req("t"));
    expect(res.status).toBe(200);
  });

  it("returns 401 with no token and does not create", async () => {
    const { client, create } = fakePrivy();
    const res = await createEnsureWalletRoute({ privy: client }).POST(req());
    expect(res.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });
});
