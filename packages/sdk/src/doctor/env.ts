import { TEMPLATE_REQUIREMENTS } from "./requirements.js";
import type { EnvCheckResult, EnvItem, EnvItemStatus, Pillar } from "./types.js";

/** Privy app ids are cuid-style: a leading `c` then 20-29 lowercase alphanumerics. */
export const PRIVY_APP_ID_PATTERN = /^c[a-z0-9]{20,29}$/;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SECRET_KEYS = new Set([
  "PRIVY_APP_SECRET",
  "PRIVY_AUTHORIZATION_KEY",
  "CONDUIT_API_KEY",
  "PEPU_BUNDLER_URL",
  "PEPU_PAYMASTER_URL",
]);

function isHttpUrl(v: string): boolean {
  try {
    const p = new URL(v);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
}

function isPlaceholder(v: string): boolean {
  return /^(<.*>|your[-_ ].*|changeme|change-me|todo|xxx+|\.\.\.|replace[-_ ]?me.*)$/i.test(v);
}

function shapeOk(key: string, v: string): boolean {
  if (key === "NEXT_PUBLIC_PRIVY_APP_ID") return PRIVY_APP_ID_PATTERN.test(v);
  if (key.endsWith("_ADDRESS")) return ADDRESS.test(v);
  if (key === "PEPU_BUNDLER_URL" || key === "PEPU_PAYMASTER_URL") return isHttpUrl(v);
  if (key === "SESSION_DURATION_MINUTES") return Number.isFinite(Number(v)) && Number(v) > 0;
  if (key === "NEXT_PUBLIC_PEPU_NETWORK") return v === "mainnet";
  return true;
}

function fixFor(key: string, status: EnvItemStatus): string {
  if (status === "ok") return "";
  const verb = status === "missing" ? "Set" : "Replace the value of";
  const hints: Record<string, string> = {
    NEXT_PUBLIC_PRIVY_APP_ID: "the App ID from the Privy dashboard (Settings)",
    PRIVY_APP_SECRET: "the app secret from the Privy dashboard (server only)",
    PRIVY_AUTHORIZATION_KEY: "the private key from generatePrivyAuthorizationKey (server only)",
    NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID: "the key quorum id Privy returns after registering the public key",
    NEXT_PUBLIC_PEPU_NETWORK: 'the value "mainnet" (the only supported network)',
  };
  const detail =
    hints[key] ??
    (key.endsWith("_ADDRESS")
      ? "a 0x-prefixed 20-byte contract address"
      : key.endsWith("_URL")
        ? "an http(s) URL"
        : "a valid value");
  return `${verb} ${key} in .env.local to ${detail}.`;
}

/**
 * Check an env map against a template's requirements. Reports presence and
 * length only: values are never returned, logged or placed in messages.
 *
 * @example
 * ```ts
 * const r = checkPepuEnv({ env: process.env, template: "game-app" });
 * r.items.filter((i) => i.status !== "ok").map((i) => i.fix);
 * ```
 */
export function checkPepuEnv(o: {
  env: Record<string, string | undefined>;
  template?: string;
  pillars?: Pillar[];
}): EnvCheckResult {
  const req = o.template ? TEMPLATE_REQUIREMENTS[o.template] : undefined;
  const keys: { key: string; required: boolean }[] = [];
  const seen = new Set<string>();
  const add = (key: string, required: boolean): void => {
    if (!seen.has(key)) {
      seen.add(key);
      keys.push({ key, required });
    }
  };
  if (req) {
    req.requiredEnv.forEach((k) => add(k, true));
    req.optionalEnv.forEach((k) => add(k, false));
  } else {
    add("NEXT_PUBLIC_PRIVY_APP_ID", true);
    add("PRIVY_APP_SECRET", true);
  }
  const pillars = o.pillars ?? req?.pillars;
  if (pillars?.includes("sponsorship")) {
    add("PEPU_BUNDLER_URL", true);
    add("PEPU_PAYMASTER_URL", true);
  }

  const items: EnvItem[] = keys.map(({ key, required }) => {
    const v = (o.env[key] ?? "").trim();
    let status: EnvItemStatus;
    if (v === "") status = "missing";
    else if (isPlaceholder(v)) status = "placeholder";
    else if (!shapeOk(key, v)) status = "malformed";
    else status = "ok";
    return { key, status, secret: SECRET_KEYS.has(key), length: v.length, required, fix: fixFor(key, status) };
  });

  let anyOfOk = true;
  for (const group of req?.requiredAnyOf ?? []) {
    const satisfied = group.some((k) => items.find((i) => i.key === k)?.status === "ok");
    if (!satisfied) {
      anyOfOk = false;
      for (const k of group) {
        const it = items.find((i) => i.key === k);
        if (it) it.fix = `Set at least one of ${group.join(" / ")} to a valid 0x address.`;
      }
    }
  }

  // Required vars must be ok; an optional var that is present must also be valid.
  const ok =
    anyOfOk && items.every((i) => (i.required ? i.status === "ok" : i.status === "ok" || i.status === "missing"));
  return { ok, items };
}
