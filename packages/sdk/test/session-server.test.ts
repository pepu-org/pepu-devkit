import type { AbiFunction, Address, Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import { createSessionActionRoute, createSessionRoutes, privySessionSigner } from "../src/session/server.js";
import type { SignAndBroadcastClient } from "../src/session/policy.js";

const contract: Address = "0x261eA5971B93237a56990206A46Bc80318e4d078";
const tap: AbiFunction = { type: "function", name: "tap", stateMutability: "nonpayable", inputs: [], outputs: [] };
const reset: AbiFunction = { type: "function", name: "reset", stateMutability: "nonpayable", inputs: [], outputs: [] };
const scope = { contractAddress: contract, functions: [tap] };
const SECRET = "wallet-auth:SUPERSECRETKEYMATERIAL123";
const wallet = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"ab".repeat(32)}` as Hex;

function fakePrivy(opts: { delegated?: boolean; policy?: unknown } = {}) {
  const calls = { create: vi.fn(), delete: vi.fn(), sign: vi.fn() };
  const privy = {
    utils: () => ({
      auth: () => ({
        verifyAccessToken: async (t: string) => {
          if (t !== "good") throw new Error("bad");
          return { user_id: "did:privy:u1" };
        },
      }),
    }),
    users: () => ({
      _get: async () => ({
        linked_accounts: [
          {
            type: "wallet",
            wallet_client_type: "privy",
            chain_type: "ethereum",
            address: wallet,
            id: "w1",
            delegated: opts.delegated ?? false,
            connector_type: "embedded",
          },
        ],
      }),
    }),
    policies: () => ({
      create: async (p: unknown) => {
        calls.create(p);
        return { id: "pol1" };
      },
      get: async () =>
        opts.policy ?? {
          rules: [{ conditions: [{ field_source: "ethereum_transaction", field: "to", value: contract }] }],
        },
      _delete: async (id: string) => calls.delete(id),
    }),
    wallets: () => ({
      ethereum: () => ({
        signTransaction: async (id: string, args: unknown) => {
          calls.sign(id, args);
          return { signed_transaction: "0xdeadbeef" };
        },
      }),
    }),
  };
  return { privy: privy as never, calls };
}

const req = (method: string, token?: string, body?: unknown) =>
  new Request("http://x/api", {
    method,
    headers: token ? { authorization: `Bearer ${token}`, "content-type": "application/json" } : {},
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

const fakeClient = (): SignAndBroadcastClient & { sent: Hex[] } => {
  const sent: Hex[] = [];
  return {
    sent,
    getTransactionCount: async () => 7,
    estimateGas: async () => 100_000n,
    getGasPrice: async () => 1_000_000_000n,
    sendRawTransaction: async ({ serializedTransaction }) => {
      sent.push(serializedTransaction);
      return HASH;
    },
  };
};

const errCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

describe("createSessionRoutes", () => {
  const base = { scope, keyQuorumId: "kq1", minutes: 15 };

  it("rejects an unscoped factory call at creation", () => {
    const { privy } = fakePrivy();
    expect(() => createSessionRoutes({ privy, scope: { contractAddress: contract, functions: [] } })).toThrow(
      /unscoped/,
    );
  });

  it("an unset contract address does not throw; every route answers CONFIG_MISSING_ENV at request time", async () => {
    const { privy } = fakePrivy();
    for (const blank of ["", undefined, "  " as ""] as const) {
      const routes = createSessionRoutes({
        privy,
        scope: { contractAddress: blank, functions: [tap] },
        contractAddressEnv: "NEXT_PUBLIC_GAME_CONTRACT_ADDRESS",
      });
      for (const res of [await routes.grant.POST(req("POST", "good")), await routes.status.GET(req("GET")), await routes.revoke.POST(req("POST"))]) {
        expect(res.status).toBe(500);
        const body = (await res.json()) as { error: { code: string; message: string } };
        expect(body.error.code).toBe("CONFIG_MISSING_ENV");
        expect(body.error.message).toContain("NEXT_PUBLIC_GAME_CONTRACT_ADDRESS");
      }
    }
  });

  it("a malformed non-empty address still throws at creation", () => {
    const { privy } = fakePrivy();
    expect(() =>
      createSessionRoutes({ privy, scope: { contractAddress: "0x123" as Address, functions: [tap] } }),
    ).toThrow(/valid/i);
  });

  it("grant: 401 with no token, error body shape", async () => {
    const { privy } = fakePrivy();
    const res = await createSessionRoutes({ ...base, privy }).grant.POST(req("POST"));
    expect(res.status).toBe(401);
    expect(await errCode(res)).toBe("AUTH_INVALID_TOKEN");
  });

  it("grant: creates a scoped policy and returns signerId + expiry", async () => {
    const { privy, calls } = fakePrivy();
    const res = await createSessionRoutes({ ...base, privy }).grant.POST(req("POST", "good"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      alreadyGranted: false,
      policyId: "pol1",
      signerId: "kq1",
      durationMinutes: 15,
    });
    const policy = calls.create.mock.calls[0]?.[0] as { name: string; rules: { method: string }[] };
    expect(policy.name.length).toBeLessThanOrEqual(49);
    expect(policy.rules[0]?.method).toBe("eth_signTransaction");
  });

  it("grant: idempotent when already delegated, no policy created", async () => {
    const { privy, calls } = fakePrivy({ delegated: true });
    const res = await createSessionRoutes({ ...base, privy }).grant.POST(req("POST", "good"));
    expect(await res.json()).toEqual({ alreadyGranted: true });
    expect(calls.create).not.toHaveBeenCalled();
  });

  it("a too-long policy name fails at factory creation with POLICY_NAME_TOO_LONG", async () => {
    const { privy } = fakePrivy();
    expect(() =>
      createSessionRoutes({
        privy,
        scope: { contractAddress: contract, functions: [{ ...tap, name: "x".repeat(60) }] },
        keyQuorumId: "kq1",
      }),
    ).toThrow(expect.objectContaining({ code: "POLICY_NAME_TOO_LONG" }));
  });

  it("grant: missing key quorum is a config error naming only the variable", async () => {
    const { privy } = fakePrivy();
    const saved = [process.env.NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID, process.env.PRIVY_KEY_QUORUM_ID];
    delete process.env.NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID;
    delete process.env.PRIVY_KEY_QUORUM_ID;
    const res = await createSessionRoutes({ privy, scope }).grant.POST(req("POST", "good"));
    if (saved[0]) process.env.NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID = saved[0];
    if (saved[1]) process.env.PRIVY_KEY_QUORUM_ID = saved[1];
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID");
  });

  it("grant: uses a custom verifyUser", async () => {
    const { privy } = fakePrivy();
    const verifyUser = vi.fn(async () => ({ userId: "did:privy:custom" }));
    const res = await createSessionRoutes({ ...base, privy, verifyUser }).grant.POST(req("POST"));
    expect(res.status).toBe(200);
    expect(verifyUser).toHaveBeenCalled();
  });

  it("status: reports delegation", async () => {
    for (const delegated of [true, false]) {
      const { privy } = fakePrivy({ delegated });
      const res = await createSessionRoutes({ ...base, privy }).status.GET(req("GET", "good"));
      expect(await res.json()).toMatchObject({ delegated, active: delegated });
    }
  });

  it("revoke: deletes a scoped policy only after the signer is gone", async () => {
    const still = fakePrivy({ delegated: true });
    const r1 = await createSessionRoutes({ ...base, privy: still.privy }).revoke.POST(
      req("POST", "good", { policyId: "pol1" }),
    );
    expect(await r1.json()).toMatchObject({ revoked: false, delegated: true });
    expect(still.calls.delete).not.toHaveBeenCalled();

    const gone = fakePrivy({ delegated: false });
    const r2 = await createSessionRoutes({ ...base, privy: gone.privy }).revoke.POST(
      req("POST", "good", { policyId: "pol1" }),
    );
    expect(await r2.json()).toMatchObject({ revoked: true, policyDeleted: true });
    expect(gone.calls.delete).toHaveBeenCalledWith("pol1");
  });

  it("revoke: refuses to delete a policy for another contract", async () => {
    const other = fakePrivy({
      policy: {
        rules: [
          {
            conditions: [
              { field_source: "ethereum_transaction", field: "to", value: "0x2222222222222222222222222222222222222222" },
            ],
          },
        ],
      },
    });
    const res = await createSessionRoutes({ ...base, privy: other.privy }).revoke.POST(
      req("POST", "good", { policyId: "p" }),
    );
    expect(await res.json()).toMatchObject({ revoked: true, policyDeleted: false });
    expect(other.calls.delete).not.toHaveBeenCalled();
  });
});

describe("createSessionActionRoute", () => {
  const mk = (privy: never, client: SignAndBroadcastClient, extra: object = {}) =>
    createSessionActionRoute<{ fn?: string }>({
      privy,
      scope,
      parse: (b) => (b ?? {}) as { fn?: string },
      buildCall: (i) => ({ to: contract, abi: [tap, reset], functionName: i.fn ?? "tap" }),
      authorizationKey: SECRET,
      client,
      ...extra,
    });

  it("409 SESSION_NONE when no delegated signer (the only no-session signal)", async () => {
    const { privy } = fakePrivy({ delegated: false });
    const res = await mk(privy, fakeClient()).POST(req("POST", "good", {}));
    expect(res.status).toBe(409);
    expect(await errCode(res)).toBe("SESSION_NONE");
  });

  it("signs with eth_signTransaction and self-broadcasts", async () => {
    const { privy, calls } = fakePrivy({ delegated: true });
    const client = fakeClient();
    const res = await mk(privy, client).POST(req("POST", "good", {}));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hash: string; explorerUrl: string };
    expect(body.hash).toBe(HASH);
    expect(body.explorerUrl).toContain(`/tx/${HASH}`);
    expect(client.sent).toEqual(["0xdeadbeef"]);
    const [id, args] = calls.sign.mock.calls[0] as [
      string,
      {
        params: { transaction: { type: number; chain_id: number; gas_limit: string } };
        authorization_context: { authorization_private_keys: string[] };
      },
    ];
    expect(id).toBe("w1");
    expect(args.params.transaction).toMatchObject({ type: 0, chain_id: 97741, gas_limit: "0x1d4c0" });
    expect(args.authorization_context.authorization_private_keys).toEqual([SECRET]);
  });

  it("refuses a function outside the scope with 403, never signing", async () => {
    const { privy, calls } = fakePrivy({ delegated: true });
    const res = await mk(privy, fakeClient()).POST(req("POST", "good", { fn: "reset" }));
    expect(res.status).toBe(403);
    expect(calls.sign).not.toHaveBeenCalled();
  });

  it("refuses another contract and nonzero value", async () => {
    const { privy } = fakePrivy({ delegated: true });
    const other = createSessionActionRoute({
      privy,
      scope,
      parse: () => ({}),
      buildCall: () => ({ to: "0x2222222222222222222222222222222222222222", abi: [tap], functionName: "tap" }),
      client: fakeClient(),
      authorizationKey: SECRET,
    });
    expect((await other.POST(req("POST", "good", {}))).status).toBe(403);
    const val = createSessionActionRoute({
      privy,
      scope,
      parse: () => ({}),
      buildCall: () => ({ to: contract, abi: [tap], functionName: "tap", value: 1n }),
      client: fakeClient(),
      authorizationKey: SECRET,
    });
    expect((await val.POST(req("POST", "good", {}))).status).toBe(403);
  });

  it("parse failure is 400", async () => {
    const { privy } = fakePrivy({ delegated: true });
    const r = createSessionActionRoute({
      privy,
      scope,
      parse: () => {
        throw new Error("bad input");
      },
      buildCall: () => ({ to: contract, abi: [tap], functionName: "tap" }),
      client: fakeClient(),
      authorizationKey: SECRET,
    });
    expect((await r.POST(req("POST", "good", {}))).status).toBe(400);
  });

  it("broadcast failure is 502, not 409", async () => {
    const { privy } = fakePrivy({ delegated: true });
    const client = fakeClient();
    client.sendRawTransaction = async () => {
      throw new Error("nonce too low");
    };
    const res = await mk(privy, client).POST(req("POST", "good", {}));
    expect(res.status).toBe(502);
  });

  it("rate limits per user", async () => {
    const { privy } = fakePrivy({ delegated: true });
    const r = mk(privy, fakeClient(), { rateLimit: { perMinute: 1 } });
    expect((await r.POST(req("POST", "good", {}))).status).toBe(200);
    expect((await r.POST(req("POST", "good", {}))).status).toBe(429);
  });

  it("never puts the authorization key in an error response", async () => {
    const { privy } = fakePrivy({ delegated: true });
    const client = fakeClient();
    client.getGasPrice = async () => {
      throw new Error("rpc down");
    };
    const res = await mk(privy, client).POST(req("POST", "good", {}));
    expect(await res.text()).not.toContain("SUPERSECRET");
  });
});

describe("privySessionSigner", () => {
  it("missing authorization key is a config error naming the variable only", async () => {
    const { privy } = fakePrivy();
    const prev = process.env.PRIVY_AUTHORIZATION_KEY;
    delete process.env.PRIVY_AUTHORIZATION_KEY;
    const signer = privySessionSigner({ privy, walletId: "w1", address: wallet, client: fakeClient() });
    await expect(signer.signAndBroadcast({ to: contract, abi: [tap], functionName: "tap" })).rejects.toThrow(
      /PRIVY_AUTHORIZATION_KEY/,
    );
    if (prev) process.env.PRIVY_AUTHORIZATION_KEY = prev;
  });

  it("signTransaction returns the raw signed hex", async () => {
    const { privy } = fakePrivy();
    const signer = privySessionSigner({ privy, walletId: "w1", address: wallet, authorizationKey: SECRET });
    const tx = {
      to: contract,
      data: "0x" as Hex,
      value: "0x0" as Hex,
      chain_id: 97741,
      type: 0 as const,
      nonce: 1,
      gas_limit: "0x1" as Hex,
      gas_price: "0x1" as Hex,
    };
    expect(await signer.signTransaction(tx)).toBe("0xdeadbeef");
  });
});

describe("createSessionActionRoute with an unset contract address", () => {
  it("answers CONFIG_MISSING_ENV at request time instead of throwing at load", async () => {
    const { privy } = fakePrivy();
    const route = createSessionActionRoute({
      privy,
      scope: { contractAddress: "", functions: [tap] },
      parse: () => ({}),
      buildCall: () => ({ to: contract, abi: [tap], functionName: "tap" }),
    });
    const res = await route.POST(req("POST", "good", {}));
    expect(res.status).toBe(500);
    expect(await errCode(res)).toBe("CONFIG_MISSING_ENV");
  });

  it("a malformed non-empty address still throws at creation", () => {
    const { privy } = fakePrivy();
    expect(() =>
      createSessionActionRoute({
        privy,
        scope: { contractAddress: "nope" as Address, functions: [tap] },
        parse: () => ({}),
        buildCall: () => ({ to: contract }),
      }),
    ).toThrow();
  });
});
