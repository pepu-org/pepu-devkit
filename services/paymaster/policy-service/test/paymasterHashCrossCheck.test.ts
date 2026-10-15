/**
 * THE test that proves the off-chain policy service and the on-chain
 * contract agree, byte for byte, on what gets hashed and signed. See
 * `contracts/test/PaymasterHashCrossCheck.t.sol` for the other half of this
 * pair — the identical fixed input vector, computed independently on the
 * Solidity side by calling the real, deployed `getHash` function (not a
 * reimplementation), asserted against the exact same `EXPECTED_GOLDEN_HASH`.
 *
 * HOW THIS GOLDEN VECTOR WAS DERIVED (so it can be re-derived if intentionally
 * changed — see the Solidity test's NatSpec for the fuller account):
 *   1. A fixed UserOp + paymaster-config vector was chosen once (arbitrary
 *      but fully specified so both languages can reproduce it exactly).
 *   2. `paymaster.getHash(0, userOp)` was called against this vector on the
 *      Solidity side (`forge test`), producing a bytes32 hash.
 *   3. `buildPaymasterHashPrefix` + `computeUserOpHash` + `computeFinalHash`
 *      (this file's own imports — real, shipped modules) were called
 *      against the identical vector on this side.
 *   4. Both independently produced
 *      `0x1ed67e1dbe62fb3e76e1fb19b74cc649cdac16c7782ed62714643c9beb88b393`.
 *   5. That value was frozen as `EXPECTED_GOLDEN_HASH` in both test files.
 *      If either implementation's byte layout, field order, or packing ever
 *      drifts, its own test fails against this frozen constant — the two
 *      files never need to talk to each other or share a build/CI step to
 *      catch drift; a one-byte disagreement here is exactly the kind of bug
 *      that would otherwise only surface as an opaque on-chain `AA33
 *      reverted` months later.
 *
 * The "paymaster" field embedded in `paymasterAndData[0:20]` is NOT read
 * from the deployed contract's own address anywhere in `_getHash` on the
 * Solidity side — it is just bytes the caller supplies. Both sides therefore
 * use an arbitrary fixed placeholder address (`0x1234`) instead of a real
 * deployed contract's address (which would depend on deployer nonce and so
 * would not be reproducible as a hardcoded constant across environments).
 * This does not weaken the cross-check: the contract hashes exactly the
 * bytes it is given, whether or not they equal `address(this)`.
 */
import { describe, expect, it } from "vitest";
import { buildPaymasterHashPrefix } from "../src/paymasterData.js";
import { computeFinalHash, computeUserOpHash } from "../src/userOpHash.js";

const EXPECTED_GOLDEN_HASH =
  "0x1ed67e1dbe62fb3e76e1fb19b74cc649cdac16c7782ed62714643c9beb88b393";

describe("paymaster <-> policy-service hash cross-check", () => {
  it("computeFinalHash matches the Solidity contract's getHash() for the frozen golden vector", () => {
    const paymasterHashPrefix = buildPaymasterHashPrefix(
      {
        paymaster: "0x0000000000000000000000000000000000001234",
        paymasterVerificationGasLimit: 3_000_000n,
        paymasterPostOpGasLimit: 1_000_000n,
      },
      { validUntil: 2_000_000_000, validAfter: 1_000_000_000 },
    );

    // Sanity-check the intermediate value too: this must byte-for-byte equal
    // the `paymasterAndData` slice logged by the Solidity test's trace
    // (`0x0000...001234` || `2dc6c0` || `0f4240` || `00` || `77359400` ||
    // `3b9aca00`), confirmed during this test's derivation.
    expect(paymasterHashPrefix).toBe(
      "0x0000000000000000000000000000000000001234000000000000000000000000002dc6c0000000000000000000000000000f42400000007735940000003b9aca00",
    );

    const userOpHash = computeUserOpHash(
      {
        sender: "0x1111111111111111111111111111111111111111",
        nonce: 7n,
        factory: undefined,
        factoryData: undefined,
        callData: "0x1234567890abcdef1234567890abcdef12345678",
        callGasLimit: 222_222n,
        verificationGasLimit: 111_111n,
        preVerificationGas: 50_000n,
        maxFeePerGas: 2_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
      },
      paymasterHashPrefix,
    );

    const finalHash = computeFinalHash(userOpHash, 31337);

    expect(finalHash).toBe(EXPECTED_GOLDEN_HASH);
  });
});
