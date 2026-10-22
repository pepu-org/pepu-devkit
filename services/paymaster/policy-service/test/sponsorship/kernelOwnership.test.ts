/**
 * Regression: the free tier / token identity check must accept the Kernel v3.1 account the PEPU SDK creates for a
 * user's Privy embedded wallet (live failure 2026-10-15: a fresh Google account's first sponsored tap was denied with
 * `sender_not_owned_by_token_user` because only Privy smart wallets were recognized).
 */
import { encodeFunctionData, parseAbi, type Address } from "viem";
import { describe, expect, it } from "vitest";
import {
  createKernelAddressDeriver,
  DEFAULT_KERNEL_ECDSA_VALIDATOR,
  DEFAULT_KERNEL_V31_FACTORY,
  kernelInitData,
  kernelSalt,
} from "../../src/sponsorship/kernelOwnership.js";
import { embeddedEthereumAddresses } from "../../src/sponsorship/identity.js";
import { freshOp, makeHarness, ORIGIN, SENDER } from "./helpers/harness.js";

/** Produced by `toPepuKernelAccount(...).getFactoryArgs()` of @pepu-chain/sdk against PEPU mainnet, owner below. */
const VECTOR_OWNER = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A" as Address;
const VECTOR_KERNEL = "0x5cD5c2bB15fFBe653015377E62926aFa60D5e0a7" as Address;
const VECTOR_FACTORY_DATA =
  "0xea6d13ac0000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001243c3b752b01845ADb2C711129d4f3966735eD98a9F09fC4cE570000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000001419E7E376E7C213B7E7e7e46cc70A5dD086DAff2A0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

describe("kernel account derivation", () => {
  it("encodes initData and the createAccount call byte-for-byte like the SDK (pinned vector)", () => {
    const createAccount = parseAbi(["function createAccount(bytes data, bytes32 salt)"]);
    const data = encodeFunctionData({
      abi: createAccount,
      functionName: "createAccount",
      args: [kernelInitData(DEFAULT_KERNEL_ECDSA_VALIDATOR, VECTOR_OWNER), kernelSalt(0n)],
    });
    expect(data.toLowerCase()).toBe(VECTOR_FACTORY_DATA.toLowerCase());
  });

  it("asks the configured factory with the pinned initData and caches the immutable result", async () => {
    const calls: { factory: Address; data: string; salt: string }[] = [];
    const derive = createKernelAddressDeriver({
      factory: DEFAULT_KERNEL_V31_FACTORY,
      validator: DEFAULT_KERNEL_ECDSA_VALIDATOR,
      index: 0n,
      read: async (factory, data, salt) => {
        calls.push({ factory, data, salt });
        return VECTOR_KERNEL.toLowerCase() as Address;
      },
    });
    expect(await derive(VECTOR_OWNER)).toBe(VECTOR_KERNEL);
    expect(await derive(VECTOR_OWNER.toLowerCase() as Address)).toBe(VECTOR_KERNEL);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ factory: DEFAULT_KERNEL_V31_FACTORY, salt: kernelSalt(0n) });
  });

  it("does not cache a failed read", async () => {
    let n = 0;
    const derive = createKernelAddressDeriver({
      factory: DEFAULT_KERNEL_V31_FACTORY,
      validator: DEFAULT_KERNEL_ECDSA_VALIDATOR,
      index: 0n,
      read: async () => {
        if (n++ === 0) throw new Error("rpc down");
        return VECTOR_KERNEL;
      },
    });
    await expect(derive(VECTOR_OWNER)).rejects.toThrow();
    expect(await derive(VECTOR_OWNER)).toBe(VECTOR_KERNEL);
  });
});

describe("embeddedEthereumAddresses", () => {
  it("keeps only Privy embedded Ethereum wallets (never external wallets or Solana)", () => {
    const embedded = { type: "wallet", wallet_client_type: "privy", connector_type: "embedded", chain_type: "ethereum", address: VECTOR_OWNER };
    expect(
      embeddedEthereumAddresses([
        embedded,
        { ...embedded, chain_type: "solana" },
        { ...embedded, wallet_client_type: "metamask", connector_type: "injected" },
        { type: "google_oauth", email: "a@b.c" },
        null,
      ]),
    ).toEqual([VECTOR_OWNER]);
  });
});

// A fake factory: owner A maps to SENDER, anything else to KERNEL_B, so tests need no chain.
const OWNER_A = "0x00000000000000000000000000000000000000a1" as Address;
const OWNER_B = "0x00000000000000000000000000000000000000b2" as Address;
const KERNEL_A = SENDER;
const KERNEL_B = "0x0000000000000000000000000000000000000043" as Address;
const fakeDerive = async (owner: Address): Promise<Address> => (owner === OWNER_A ? KERNEL_A : KERNEL_B);

function run(h: ReturnType<typeof makeHarness>, cred: string, privyToken: string | null, sender: Address) {
  return h.engine.evaluate({ appToken: cred, origin: ORIGIN, privyToken, userOp: freshOp({ sender }) });
}

describe("token identity with requireSenderOwnership and a Kernel account (the live failure)", () => {
  it("BEFORE the fix: a Kernel account Privy does not know is denied sender_not_owned_by_token_user", async () => {
    const h = makeHarness({ requireSenderOwnership: true }); // no deriveKernelAddress: the old behaviour
    h.resolver.embedded.set("user-a", [OWNER_A]);
    const { token } = h.addFreeApp();
    expect(await run(h, token, h.asUser("user-a"), KERNEL_A)).toMatchObject({ status: "denied", reason: "sender_not_owned_by_token_user" });
  });

  it("accepts the Kernel account derived from the user's own embedded wallet and charges the FREE tier", async () => {
    const h = makeHarness({ requireSenderOwnership: true, deriveKernelAddress: fakeDerive });
    h.resolver.embedded.set("user-a", [OWNER_A]);
    const { token } = h.addFreeApp();
    const r = await run(h, token, h.asUser("user-a"), KERNEL_A);
    expect(r.status).toBe("approved");
    expect(h.db.freeIdentitySpendWei("privy:user-a", 0)).toBeGreaterThan(0n);
  });

  it("falls back to the free tier when the project cannot cover the op, with the Kernel account (the demo's first op)", async () => {
    const h = makeHarness({ requireSenderOwnership: true, deriveKernelAddress: fakeDerive });
    h.resolver.embedded.set("user-a", [OWNER_A]);
    const { token } = h.addProject({ balance: 1n }); // project exhausted
    const r = await run(h, token, h.asUser("user-a"), KERNEL_A);
    expect(r.status).toBe("approved");
    expect(h.db.freeIdentitySpendWei("privy:user-a", 0)).toBeGreaterThan(0n);
  });

  it("SECURITY: a user cannot get sponsorship for another user's Kernel account", async () => {
    const h = makeHarness({ requireSenderOwnership: true, deriveKernelAddress: fakeDerive });
    h.resolver.embedded.set("user-a", [OWNER_A]);
    h.resolver.embedded.set("user-b", [OWNER_B]);
    const { token } = h.addFreeApp();
    expect(await run(h, token, h.asUser("user-b"), KERNEL_A)).toMatchObject({ reason: "sender_not_owned_by_token_user" });
    // a user with no embedded wallet owns nothing
    expect(await run(h, token, h.asUser("user-c"), KERNEL_A)).toMatchObject({ reason: "sender_not_owned_by_token_user" });
  });

  it("SECURITY: an arbitrary sender is still denied", async () => {
    const h = makeHarness({ requireSenderOwnership: true, deriveKernelAddress: fakeDerive });
    h.resolver.embedded.set("user-a", [OWNER_A]);
    const { token } = h.addFreeApp();
    const stranger = "0x00000000000000000000000000000000000000ee" as Address;
    expect(await run(h, token, h.asUser("user-a"), stranger)).toMatchObject({ reason: "sender_not_owned_by_token_user" });
  });

  it("fails closed when Privy cannot list wallets and has no smart wallet for the sender", async () => {
    const h = makeHarness({ requireSenderOwnership: true, deriveKernelAddress: fakeDerive });
    h.resolver.embedded.set("user-a", [OWNER_A]);
    h.resolver.throwOnList = true;
    h.resolver.throwOnLookup = true;
    const { token } = h.addFreeApp();
    expect(await run(h, token, h.asUser("user-a"), KERNEL_A)).toMatchObject({ reason: "sender_not_owned_by_token_user" });
  });

  it("fails closed when the factory read throws", async () => {
    const h = makeHarness({
      requireSenderOwnership: true,
      deriveKernelAddress: async () => {
        throw new Error("rpc down");
      },
    });
    h.resolver.embedded.set("user-a", [OWNER_A]);
    const { token } = h.addFreeApp();
    expect(await run(h, token, h.asUser("user-a"), KERNEL_A)).toMatchObject({ reason: "sender_not_owned_by_token_user" });
  });

  it("a Privy smart wallet the user owns is still accepted", async () => {
    const h = makeHarness({ requireSenderOwnership: true, deriveKernelAddress: fakeDerive });
    const { token } = h.addFreeApp();
    h.resolver.owners.set(SENDER.toLowerCase(), "user-z");
    expect((await run(h, token, h.asUser("user-z"), SENDER)).status).toBe("approved");
  });

  it("caches a proven Kernel ownership (one wallet listing per sender within the TTL)", async () => {
    const h = makeHarness({ requireSenderOwnership: true, deriveKernelAddress: fakeDerive });
    h.resolver.embedded.set("user-a", [OWNER_A]);
    const { token } = h.addFreeApp();
    let listings = 0;
    const orig = h.resolver.listEmbeddedWallets.bind(h.resolver);
    h.resolver.listEmbeddedWallets = async (u) => {
      listings++;
      return orig(u);
    };
    const tok = h.asUser("user-a");
    for (let i = 0; i < 3; i++) await run(h, token, tok, KERNEL_A);
    expect(listings).toBe(1);
  });
});

describe("end to end with the SDK's real account shape", () => {
  it("approves the exact sender the SDK derives for an embedded wallet, asking the factory with the SDK's initData", async () => {
    const asked: string[] = [];
    const derive = createKernelAddressDeriver({
      factory: DEFAULT_KERNEL_V31_FACTORY,
      validator: DEFAULT_KERNEL_ECDSA_VALIDATOR,
      index: 0n,
      // stands in for the on-chain factory: answers only for the SDK's pinned initData
      read: async (_factory, data) => {
        asked.push(data);
        if (data.toLowerCase() !== kernelInitData(DEFAULT_KERNEL_ECDSA_VALIDATOR, VECTOR_OWNER).toLowerCase()) throw new Error("unexpected initData");
        return VECTOR_KERNEL;
      },
    });
    const h = makeHarness({ requireSenderOwnership: true, deriveKernelAddress: derive });
    h.resolver.embedded.set("fresh-google-user", [VECTOR_OWNER]);
    const { token } = h.addProject({ balance: 1n }); // the project cannot cover the first op: free tier takes it
    const r = await run(h, token, h.asUser("fresh-google-user"), VECTOR_KERNEL);
    expect(r.status).toBe("approved");
    expect(asked).toHaveLength(1);
    expect(h.db.freeIdentitySpendWei("privy:fresh-google-user", 0)).toBeGreaterThan(0n);
  });
});
