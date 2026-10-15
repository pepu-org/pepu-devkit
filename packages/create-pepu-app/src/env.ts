import { pepuMainnet } from "@pepu-chain/sdk";

/** Variables whose values are public network facts the CLI may fill in. Empty today:
 * every template is mainnet only and the SDK already knows the network. */
export const NETWORK_PREFILL: Readonly<Record<string, string>> = {};

const SECRET_PATTERN = /SECRET|AUTHORIZATION_KEY|API_KEY|PAYMASTER_URL|BUNDLER_URL/;

/** True for variables that hold a credential (never prefilled, never printed). */
export function isSecretEnvKey(key: string): boolean {
  return SECRET_PATTERN.test(key);
}

export function networkHeader(): string {
  const explorer = pepuMainnet.blockExplorers.default.url;
  return [
    "# --- PEPU network (prefilled by create-pepu-app) ---------------------------",
    `# ${pepuMainnet.name}, mainnet, chainId ${pepuMainnet.id}, currency ${pepuMainnet.nativeCurrency.symbol}.`,
    `# Public RPC: ${pepuMainnet.rpcUrls.default.http[0]}`,
    `# Explorer:   ${explorer}`,
    "# The SDK already knows these; you never need to configure them by hand.",
    "# Secrets below are intentionally blank. Fill them in yourself and never",
    "# commit this file.",
    "",
  ].join("\n");
}

/**
 * Builds `.env.local` from a template's `.env.example`: keeps every comment and
 * line, sets the public network variables the template already declares, and
 * prepends a network header. Secrets and anything else stay exactly as the
 * example has them (blank, or the example's own public default).
 */
export function buildEnvLocal(example: string): string {
  const lines = example.split(/\r?\n/).map((line) => {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!m) return line;
    const key = m[1] as string;
    const prefill = NETWORK_PREFILL[key];
    return prefill !== undefined && (m[2] ?? "").trim() === "" ? `${key}=${prefill}` : line;
  });
  return networkHeader() + lines.join("\n");
}

/** Parses `KEY=value` lines (comments and blanks ignored). */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1] as string] = (m[2] ?? "").trim();
  }
  return out;
}
