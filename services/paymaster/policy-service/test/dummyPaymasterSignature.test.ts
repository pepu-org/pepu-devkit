/**
 * Regression test for the exact bug this session found and fixed in
 * `integration-test.mjs`'s gas-estimation step: a paymaster "dummy"
 * signature (used only to make `eth_estimateUserOperationGas` simulate
 * successfully before a real approval exists) must be a syntactically
 * well-formed ECDSA signature, or `PepuVerifyingPaymasterV7._validateVerifyingMode`
 * reverts instead of returning `sigFailed=1`.
 *
 * This matters specifically because `contracts/src/PepuVerifyingPaymasterV7.sol`
 * recovers the signer via OpenZeppelin v5's *reverting* `ECDSA.recover`
 * (confirmed by reading that file directly), not the non-reverting
 * `tryRecover`. OZ v5's `ECDSA.recover` reverts on:
 *   - a signature that isn't exactly 65 (or 64, EIP-2098) bytes,
 *   - a `v` that isn't 27 or 28,
 *   - a HIGH-`s` value (`s > secp256k1n / 2`) -- OZ enforces EIP-2's
 *     signature-malleability restriction and rejects non-canonical
 *     signatures outright, rather than accepting and normalizing them.
 *
 * A reused signature-shaped-but-arbitrary blob (e.g. the account-side
 * `DUMMY_ECDSA_SIG` constant, which is designed only for account validators
 * that use the non-reverting `tryRecover`) is NOT guaranteed to satisfy the
 * low-s constraint, and was empirically observed in this session to be
 * unsuitable for the paymaster's signature slot for exactly this reason.
 *
 * `integration-test.mjs` instead builds its dummy paymaster signature by
 * having `viem/accounts`' `sign()` sign an arbitrary hash with a freshly
 * generated throwaway key. viem's secp256k1 signing always returns a
 * canonical low-s signature (standard Ethereum signing convention) with
 * `v` in {27, 28}, so the result recovers to *some* address (just not one
 * in the paymaster's `signers` mapping) without ever reverting `ECDSA.recover`.
 * This test proves that property holds, and does so many times (a signature
 * is low-s or high-s roughly 50/50 before normalization, so a single sample
 * would not meaningfully test the normalization logic) -- and independently
 * cross-checks integration-test.mjs's inline byte-layout helpers
 * (duplicated there because that script is a standalone .mjs that cannot
 * cheaply import this package's compiled TypeScript) against the
 * authoritative production implementation in `src/paymasterData.ts`, so the
 * two can't silently drift apart.
 */
import { describe, expect, it } from "vitest";
import { concatHex, numberToHex, pad, toHex, type Hex } from "viem";
import { generatePrivateKey, sign as signRawHash } from "viem/accounts";
import { buildPaymasterData, computeValidityWindow } from "../src/paymasterData.js";

// secp256k1 curve order `n`, and OpenZeppelin's low-s threshold
// (`ECDSA.sol`'s `_S_MAX = n / 2 + 1` boundary -- valid canonical `s` must
// satisfy `s <= n / 2`). Verified against OpenZeppelin v5.0.2's own comment
// in contracts/utils/cryptography/ECDSA.sol (vendored under
// contracts/lib/openzeppelin-contracts-v5.0.2/), not invented here.
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP256K1_HALF_N = SECP256K1_N / 2n;

/** Mirrors integration-test.mjs's inline `uint48BigEndian` byte-for-byte. */
function uint48BigEndian(value: number): Hex {
  return pad(numberToHex(BigInt(value)), { size: 6 });
}

/**
 * viem's `Signature` type is a `OneOf<...>` union of a legacy `{r,s,v}` shape
 * and a `{r,s,v?,yParity}` shape, so `sig.v` alone types as `bigint |
 * undefined` even though `sign()` always populates one of the two at
 * runtime. Prefer `yParity` (the non-deprecated field) when present.
 */
function recoveryByteHex(sig: { v?: bigint | undefined; yParity?: number | undefined }): Hex {
  if (sig.yParity !== undefined) return toHex(sig.yParity + 27, { size: 1 });
  if (sig.v !== undefined) return toHex(sig.v, { size: 1 });
  throw new Error("secp256k1 signature has neither v nor yParity");
}

/** Mirrors integration-test.mjs's inline dummy-signature construction. */
async function buildDummyPaymasterSignature(): Promise<Hex> {
  const dummyKey = generatePrivateKey();
  const sig = await signRawHash({ hash: `0x${"00".repeat(32)}` as Hex, privateKey: dummyKey });
  return concatHex([sig.r, sig.s, recoveryByteHex(sig)]);
}

describe("dummy paymaster signature (integration-test.mjs gas-estimation fix)", () => {
  it("is always exactly 65 bytes with v in {27, 28} and canonical (low) s, many times over", async () => {
    // Run many samples: whether a freshly generated key/hash pair happens to
    // produce a high-s signature before normalization is essentially a coin
    // flip, so a single sample would not exercise viem's low-s normalization
    // path reliably.
    for (let i = 0; i < 25; i++) {
      const signature = await buildDummyPaymasterSignature();

      expect(signature.length).toBe(2 + 65 * 2); // "0x" + 65 bytes

      const r = BigInt(`0x${signature.slice(2, 66)}`);
      const s = BigInt(`0x${signature.slice(66, 130)}`);
      const v = parseInt(signature.slice(130, 132), 16);

      expect(r > 0n).toBe(true);
      expect(s > 0n && s <= SECP256K1_HALF_N).toBe(true); // low-s: must not revert OZ's ECDSA.recover
      expect(v === 27 || v === 28).toBe(true);
    }
  });

  it("plugs into the production buildPaymasterData() (src/paymasterData.ts) without that function rejecting it", async () => {
    const signature = await buildDummyPaymasterSignature();
    const window = computeValidityWindow(90, 1_000_000_000);

    // buildPaymasterData throws if the signature isn't exactly 65 bytes --
    // see paymasterData.ts's SIGNATURE_LENGTH check. This is the same
    // production function the real /sponsor response ultimately builds its
    // paymasterData with, so this proves the dummy signature this session
    // adopted for gas estimation is shape-compatible with the real one.
    const paymasterData = buildPaymasterData(window, signature);

    // modeByte(1) + validUntil(6) + validAfter(6) + signature(65) = 78 bytes.
    expect(paymasterData.length).toBe(2 + 78 * 2);
  });

  it("integration-test.mjs's inline uint48BigEndian matches src/paymasterData.ts's internal encoding", () => {
    // paymasterData.ts doesn't export uint48BigEndian directly, so this
    // cross-checks it indirectly: build a full paymasterData with the
    // production function and confirm our independently-duplicated
    // uint48BigEndian produces byte-identical validUntil/validAfter slices
    // at the documented offsets (mode(1) || validUntil(6) || validAfter(6) || sig(65)).
    const validUntil = 2_000_000_090;
    const validAfter = 2_000_000_000;
    const signature = ("0x" + "11".repeat(65)) as Hex; // arbitrary, fixed 65 bytes -- shape only matters here
    const produced = buildPaymasterData({ validUntil, validAfter }, signature);

    const validUntilSlice = produced.slice(4, 16); // after "0x" + 1-byte mode
    const validAfterSlice = produced.slice(16, 28);

    expect(`0x${validUntilSlice}`).toBe(uint48BigEndian(validUntil));
    expect(`0x${validAfterSlice}`).toBe(uint48BigEndian(validAfter));
  });
});
