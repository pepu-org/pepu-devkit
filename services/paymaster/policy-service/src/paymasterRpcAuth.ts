/**
 * Auth for the ERC-7677 paymaster JSON-RPC surface (paymasterRpc.ts) — a
 * DELIBERATELY DIFFERENT `AuthChecker` than privyAuth.ts's, wired into a
 * SECOND `PolicyEngine` instance in index.ts that otherwise shares the exact
 * same `db`/`apps`/`allowlist`/`signerAccount`/caps as the REST `/sponsor`
 * engine — see index.ts. `policy.ts` itself is never forked or duplicated;
 * only the auth dependency differs between the two engine instances.
 *
 * ## Why this exists (read before touching)
 *
 * `POST /sponsor` (privyAuth.ts) verifies a Privy access token and proves
 * `userOp.sender` is a smart wallet OWNED by that specific logged-in Privy
 * user, before ever considering per-user caps. That works because our own
 * frontend calls `/sponsor` directly and has a live Privy access token to
 * attach as a Bearer header.
 *
 * Privy's smart-wallet paymaster integration does not present one. Verified
 * in this session (2026-09-30) against:
 *
 *   - Privy's dashboard docs
 *     (docs.privy.io/wallets/using-wallets/evm-smart-wallets/setup/configuring-dashboard):
 *     the "Paymaster URL" field is a bare URL with no separate header/secret
 *     field, and Privy's own security guidance is to configure an "allowed
 *     domains" restriction on YOUR paymaster PROVIDER's own dashboard —
 *     advice that only makes sense if the calling context is the end user's
 *     BROWSER (which sends a same-site `Origin` header), not a Privy backend
 *     service (which wouldn't need "allowed domains" at all).
 *   - `privy-io/base-paymaster-example` (GitHub,
 *     `hooks/SmartAccountContext.tsx`): the paymaster is called via a plain
 *     `viem` `http()` transport with no auth header attached, from code that
 *     runs client-side in the dapp's own React tree.
 *
 * Conclusion: when Privy's smart-wallet SDK calls a dashboard-configured
 * paymaster URL, it does so directly from the END USER'S browser runtime,
 * as a bare, unauthenticated JSON-RPC POST. There is no Privy access token,
 * no signed identity claim — nothing in the call that proves "this sender
 * belongs to a real logged-in user" the way privyAuth.ts's ownership check
 * does. This is a hard protocol-level constraint of how ERC-7677 paymaster
 * URLs are consumed industry-wide, not a corner this session cut. See
 * README "Paymaster JSON-RPC auth trade-off" for the full writeup.
 *
 * ## What this module does instead
 *
 * `authenticate()` never rejects on identity — there is no identity claim
 * to check. What it DOES do is key per-"user" caps (userHourly/Daily/
 * LifetimeCount + Spend — see db.ts) off the UserOperation's OWN SENDER
 * ADDRESS instead of a Privy `user_id`. This is not equivalent to the
 * `/sponsor` path's guarantee (see the trade-off below), but it is not a
 * no-op either: every other unmodified PolicyEngine check — the
 * destination allowlist, per-app daily/lifetime budget, and the global
 * circuit breaker (policy.ts / db.ts, untouched) — still runs in full for
 * every request through this path.
 *
 * ## The trade-off, stated plainly (flagged, not hidden)
 *
 * Kernel smart-account factories are PERMISSIONLESS infrastructure: anyone
 * can deploy their own Kernel v3 account through the exact same factory /
 * ECDSA validator this deployment uses, with themselves as owner. So
 * "sender is a Kernel account from our factory" proves nothing about WHO
 * controls it — unlike the Privy ownership check, this cannot distinguish a
 * real app user from an attacker's own freshly-deployed smart account. A
 * caller that knows this endpoint's URL can mint unlimited fresh sender
 * addresses, each getting its own fresh set of per-sender caps.
 *
 * The backstops that still apply, fully unforked, in that scenario:
 *   - the per-app daily/lifetime spend cap (`app.dailySpendCapWei` /
 *     `lifetimeSpendCapWei`) — bounds any single app's total exposure;
 *   - the GLOBAL circuit breaker (`globalDailySpendCeilingWei`) — bounds
 *     total exposure across every app/user/sender combined, and halts ALL
 *     sponsorship once tripped, regardless of how many sender addresses are
 *     involved;
 *   - the destination allowlist — a drained budget can only ever pay for
 *     calls to contracts already explicitly approved (e.g. TapScore), never
 *     for moving value anywhere else;
 *   - server.ts's per-app URL-embedded token and optional Origin allowlist,
 *     and paymasterRpc.ts's factory/factoryData toggle — see those modules.
 *
 * What is genuinely lost, and cannot be recovered without a real identity
 * signal from Privy: a single malicious actor CAN consume more of the daily
 * sponsorship budget than any one legitimate user could (bounded by the
 * global ceiling, not by a per-user cap), and doing so denies real users
 * service until the ceiling resets or an admin intervenes (`POST
 * /admin/circuit-breaker/reset`). This is a denial-of-service risk on the
 * sponsorship budget, not a fund-theft risk — the paymaster's own deposit
 * can only ever be spent on gas for calls to allowlisted contracts.
 */
import type { Address } from "viem";
import type { AuthChecker } from "./privyAuth.js";

/** userId format used for caps in this path — never confused with a real Privy `user_id` string. */
export function senderKeyedUserId(sender: Address): string {
  return `sender:${sender.toLowerCase()}`;
}

/**
 * Passed as `accessToken` to `PolicyEngine.evaluate()` for this path only,
 * purely so its `if (!accessToken)` guard doesn't fire. The `AuthChecker`
 * below ignores the token value entirely — see module doc comment for why
 * there is nothing meaningful it could check instead.
 */
export const UNAUTHENTICATED_PAYMASTER_RPC_TOKEN = "erc7677-paymaster-rpc:no-privy-token-available";

/**
 * Builds the `AuthChecker` wired into the paymaster-JSON-RPC-only
 * `PolicyEngine` instance (see index.ts). Always succeeds; keys the
 * resulting "userId" to the UserOperation's sender address. See module doc
 * comment for the full reasoning and the trade-off this represents.
 */
export function createSenderKeyedAuthChecker(): AuthChecker {
  return {
    async verifyToken() {
      // Not exercised: `authenticate()` below never delegates to this method
      // for this checker. Implemented only to satisfy the `AuthChecker`
      // interface shape.
      return { ok: true, userId: "unused" };
    },
    async verifySenderOwnership() {
      return true;
    },
    async authenticate(_accessToken: string, sender: Address) {
      return { ok: true, userId: senderKeyedUserId(sender) };
    },
  };
}
