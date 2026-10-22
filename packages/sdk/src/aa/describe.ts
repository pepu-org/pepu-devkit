import { PepuBundlerError, PepuPaymasterError, explainError, getErrorEntry, toPepuError } from "../errors.js";
import type { PepuErrorCode } from "../errors.js";
import { PAYMASTER_DENIAL_REASONS, paymasterReasonToError } from "../paymaster/reasons.js";

interface AaInfo {
  code: PepuErrorCode;
  paymaster?: boolean;
  hint: string;
}

/**
 * AAxx meaning, per the EntryPoint v0.7 revert reasons, with the PEPU-specific
 * fix. Ported from the sponsored-demo and sponsored-session-app runs.
 */
const AA_HINTS: Readonly<Record<string, AaInfo>> = {
  AA10: { code: "BUNDLER_AA_FAILED", hint: "The sender is already deployed but initCode was sent. Drop the factory fields." },
  AA13: { code: "BUNDLER_AA_FAILED", hint: "initCode (account factory) reverted. Check the Kernel factory address and the owner." },
  AA14: { code: "BUNDLER_AA_FAILED", hint: "initCode deployed a different address than the sender. Rebuild the account with the same owner and index." },
  AA20: { code: "BUNDLER_AA_FAILED", hint: "The account is not deployed and no initCode was sent. Use a fresh account object so the factory fields are included." },
  AA21: { code: "BUNDLER_AA_FAILED", hint: "The account cannot pay its prefund. Use the paymaster, or fund the account." },
  AA22: { code: "BUNDLER_AA_FAILED", hint: "The UserOperation's validity window expired. Resend a fresh one." },
  AA23: { code: "BUNDLER_AA_FAILED", hint: "Account validation reverted: wrong signer, wrong signature format, or a session policy rejected the call." },
  AA24: { code: "BUNDLER_AA_FAILED", hint: "Signature rejected by the account. Sign with the owner the account was built for." },
  AA25: { code: "BUNDLER_AA_FAILED", hint: "Invalid nonce: another UserOperation from this account is pending. Wait for it, then retry." },
  AA26: { code: "BUNDLER_AA_FAILED", hint: "verificationGasLimit too low. Re-estimate gas." },
  AA31: { code: "PAYMASTER_NO_BALANCE", paymaster: true, hint: "The paymaster's EntryPoint deposit is too low. Deposit more PEPU to the paymaster." },
  AA32: { code: "PAYMASTER_DENIED", paymaster: true, hint: "The paymaster signature expired. Request paymaster data again." },
  AA33: { code: "PAYMASTER_DENIED", paymaster: true, hint: "Paymaster validation reverted. Check the paymaster contract and that its signer matches the policy service." },
  AA34: { code: "PAYMASTER_DENIED", paymaster: true, hint: "Paymaster signature rejected. The policy service signer does not match the paymaster contract." },
  AA36: { code: "BUNDLER_AA_FAILED", paymaster: true, hint: "Paymaster gas limits too low. Re-estimate with the paymaster stub data." },
  AA40: { code: "BUNDLER_AA_FAILED", hint: "Verification used more gas than verificationGasLimit. Re-estimate gas." },
  AA41: { code: "BUNDLER_AA_FAILED", hint: "Paymaster verification used more gas than its limit. Re-estimate gas." },
  AA50: { code: "BUNDLER_AA_FAILED", hint: "The postOp reverted. Check the paymaster's postOp path." },
  AA51: { code: "BUNDLER_AA_FAILED", hint: "Prefund below actualGasCost. Re-estimate fees; PEPU needs fee headroom (the SDK applies 20%)." },
  AA90: { code: "BUNDLER_AA_FAILED", hint: "Invalid beneficiary on handleOps. This is a bundler configuration problem." },
  AA91: { code: "BUNDLER_AA_FAILED", hint: "Failed to send funds to the beneficiary. This is a bundler configuration problem." },
  AA95: { code: "BUNDLER_AA_FAILED", hint: "Out of gas in handleOps. Raise the gas limits." },
};

/**
 * Remove anything credential-shaped from text that may reach a message:
 * `/paymaster/<token>` URL paths, bearer tokens, API keys, JWTs and URL
 * credentials.
 *
 * @example
 * redactSecrets("POST https://pm.example/paymaster/sk_live_123 failed");
 * // "POST https://pm.example/paymaster/[redacted] failed"
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/\/paymaster\/[^\s/"'`)\]?#]+/gi, "/paymaster/[redacted]")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(/(x-api-key["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, "$1[redacted]")
    .replace(/(privyAccessToken["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, "$1[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[redacted-jwt]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@");
}

/** Fix text for denial reasons where the catalog's generic fix for the code is not specific enough. */
const DENIAL_HINTS: Readonly<Record<string, string>> = {
  sender_not_owned_by_token_user:
    "The smart account is not one of the signed-in user's accounts. Send the access token of the user who owns this account, and build the account from that user's embedded wallet.",
  free_tier_identity_required:
    "The free tier needs a verified Privy access token. Forward it to the paymaster as context.privyAccessToken (the SDK combo routes do this by default).",
};

/**
 * The paymaster's denial, if this failure is one. viem maps the service's JSON-RPC -32000 to a generic
 * "Missing or invalid parameters." whose real text is in `details` ("Sponsorship denied: ...") and `data.reason`.
 */
function paymasterDenial(text: string): PepuPaymasterError | null {
  const message = /Sponsorship denied:\s*([^\r\n]+)/i.exec(text)?.[1]?.trim();
  let reason: string | undefined;
  let at = Infinity;
  for (const r of PAYMASTER_DENIAL_REASONS) {
    const i = text.search(new RegExp(`(?<![a-z_])${r}(?![a-z_])`));
    if (i >= 0 && i < at) {
      at = i;
      reason = r;
    }
  }
  if (message === undefined && reason === undefined) return null;
  const err = paymasterReasonToError(reason, message);
  const hint = (reason && DENIAL_HINTS[reason]) ?? getErrorEntry(err.code).fix;
  return new PepuPaymasterError(err.code, err.message, { hint, details: err.details, ...(err.retryable ? { retryable: true } : {}) });
}

function collect(e: unknown): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  let cur: unknown = e;
  for (let d = 0; d < 8 && cur !== undefined && cur !== null && !seen.has(cur); d++) {
    seen.add(cur);
    if (typeof cur === "object") {
      const o = cur as Record<string, unknown>;
      for (const k of ["shortMessage", "message", "details", "reason"]) {
        const v = o[k];
        if (typeof v === "string" && v.length > 0 && !parts.includes(v)) parts.push(v);
      }
      const data = o["data"];
      if (data && typeof data === "object") {
        const r = (data as Record<string, unknown>)["reason"];
        if (typeof r === "string") parts.push(r);
      }
      cur = o["cause"];
    } else {
      parts.push(String(cur));
      break;
    }
  }
  return parts.join("\n");
}

/**
 * Turn anything thrown by the bundler, paymaster or viem/Privy stack into a
 * typed PepuError. Walks the `cause` chain (viem's `details` is where the
 * paymaster's real denial reason lives; Privy's own log prints
 * `[object Error]`), maps `AA10`..`AA9x` to a fix, maps paymaster reason codes
 * through the error catalog, and redacts tokens and URL credentials.
 * Port of `templates/sponsored-demo/lib/describe-error.ts`.
 *
 * @example
 * try { await sendSponsored({ client, calls }); }
 * catch (e) { const err = describeUserOpFailure(e); console.log(err.code, err.hint); }
 */
export function describeUserOpFailure(e: unknown): PepuBundlerError | PepuPaymasterError {
  const text = redactSecrets(collect(e));
  const headline = text.split("\n")[0]?.trim() || "UserOperation failed";
  const opts = (hint?: string) => ({ ...(hint ? { hint } : {}), cause: e });

  const aa = /\bAA(\d{2})\b/.exec(text);
  if (aa) {
    const key = `AA${aa[1]}`;
    const info = AA_HINTS[key];
    if (info) {
      const msg = `${key}: ${headline}`;
      return info.paymaster && info.code !== "BUNDLER_AA_FAILED"
        ? new PepuPaymasterError(info.code, msg, opts(info.hint))
        : new PepuBundlerError(info.code, msg, opts(info.hint));
    }
    return new PepuBundlerError("BUNDLER_AA_FAILED", `${key}: ${headline}`, opts());
  }

  const denial = paymasterDenial(text);
  if (denial) return denial;

  const explained = explainError(text);
  if (explained.code.startsWith("PAYMASTER_")) {
    return new PepuPaymasterError(explained.code, headline, opts(explained.fix));
  }
  if (explained.code !== "UNKNOWN") {
    return new PepuBundlerError(explained.code, headline, opts(explained.fix));
  }
  const pe = toPepuError(e);
  if (pe.code !== "UNKNOWN") return new PepuBundlerError(pe.code, redactSecrets(pe.message), opts(pe.hint));
  return new PepuBundlerError("UNKNOWN", headline, opts(getErrorEntry("UNKNOWN").fix));
}
