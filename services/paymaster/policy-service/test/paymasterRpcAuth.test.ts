/**
 * Unit tests for the sender-keyed `AuthChecker` used by the paymaster
 * JSON-RPC surface — see src/paymasterRpcAuth.ts's module doc comment for
 * why this exists (Privy calls a configured paymaster URL directly from the
 * end user's browser with no Privy access token attached, so there is no
 * ownership claim to verify the way privyAuth.ts's checker does).
 */
import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { createSenderKeyedAuthChecker, senderKeyedUserId } from "../src/paymasterRpcAuth.js";

const SENDER = "0xAbCdEf0000000000000000000000000000001234" as Address;

describe("createSenderKeyedAuthChecker", () => {
  it("authenticate() always succeeds, regardless of the token value", async () => {
    const auth = createSenderKeyedAuthChecker();

    const withPlaceholder = await auth.authenticate("erc7677-paymaster-rpc:no-privy-token-available", SENDER);
    expect(withPlaceholder).toEqual({ ok: true, userId: senderKeyedUserId(SENDER) });

    // Not treated as a real credential to verify -- any string succeeds,
    // because there is nothing this checker is able to verify (see doc
    // comment). It is `server.ts`/`index.ts`'s job to only ever call this
    // path with the fixed placeholder, not arbitrary caller input.
    const withArbitraryString = await auth.authenticate("anything at all", SENDER);
    expect(withArbitraryString).toEqual({ ok: true, userId: senderKeyedUserId(SENDER) });
  });

  it("keys the userId to the lowercased sender address, so caps bind per-wallet not per-Privy-user", async () => {
    const auth = createSenderKeyedAuthChecker();
    const mixedCase = "0xAbCdEf0000000000000000000000000000001234" as Address;

    const result = await auth.authenticate("token", mixedCase);

    expect(result).toEqual({ ok: true, userId: "sender:0xabcdef0000000000000000000000000000001234" });
  });

  it("different senders get different userIds (independent per-sender cap buckets)", async () => {
    const auth = createSenderKeyedAuthChecker();
    const senderA = "0x0000000000000000000000000000000000000001" as Address;
    const senderB = "0x0000000000000000000000000000000000000002" as Address;

    const resultA = await auth.authenticate("token", senderA);
    const resultB = await auth.authenticate("token", senderB);

    expect(resultA.ok && resultB.ok && resultA.userId !== resultB.userId).toBe(true);
  });

  it("verifySenderOwnership() always returns true (there is no ownership signal available to check)", async () => {
    const auth = createSenderKeyedAuthChecker();
    await expect(auth.verifySenderOwnership("whatever", SENDER)).resolves.toBe(true);
  });
});
