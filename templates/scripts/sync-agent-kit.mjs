#!/usr/bin/env node
/**
 * Generates the agent wiring in every template from templates/_agent:
 *   - copies .cursor/mcp.json, .vscode/mcp.json,
 *     .claude/settings.json and CLAUDE.md verbatim;
 *   - renders _agent/AGENTS.base.md with per-template variables (from
 *     packages/create-pepu-app/src/templates.json) and writes it into the
 *     template's AGENTS.md between the pepu-agent-kit markers, leaving the
 *     rest of the file untouched.
 * Run after editing anything in templates/_agent or templates.json.
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEMPLATES, templatesRoot } from "./sync-design.mjs";

export { TEMPLATES, templatesRoot };

export const BEGIN = "<!-- BEGIN:pepu-agent-kit -->";
export const END = "<!-- END:pepu-agent-kit -->";
const NEXT_BLOCK = "<!-- BEGIN:nextjs-agent-rules -->";

/** Files copied verbatim from _agent into each template root. */
export const VERBATIM = [
  ".cursor/mcp.json",
  ".vscode/mcp.json",
  ".claude/settings.json",
  "CLAUDE.md",
];

const registryPath = path.join(
  templatesRoot,
  "..",
  "packages",
  "create-pepu-app",
  "src",
  "templates.json",
);

const DASHBOARD = {
  "login-methods": "enable the login methods you use (email, Google, ...)",
  "login-methods.google": "enable Google login",
  "allowed-origins": "add your app origin including the port (e.g. `http://localhost:3000`)",
  "embedded-wallets": "enable embedded wallets and create-on-login",
  "smart-wallets":
    "enable Smart Wallets: chain 97741, provider Kernel, plus bundler and paymaster URLs",
  "authorization-key-quorum": "register the authorization key as a key quorum",
};

const code = (items) => items.map((i) => `\`${i}\``).join(", ");

/** SDK subpaths this template should import from, by feature combination. */
function sdkSubpaths(features) {
  const has = (p) => features.includes(p);
  const lines = ["- `@pepu-chain/sdk` (core): chain, addresses, explorer links, multicall, errors."];
  if (has("login")) {
    lines.push(
      "- Login and wallet: `/privy` (config), `/privy/react` (provider, `WalletGate`, `useEmbeddedWallet`, `useEnsureWallet`), `/privy/server` (`createEnsureWalletRoute`, `requireUser`), `/privy/wagmi` (wagmi on top of Privy).",
    );
  }
  if (has("session") && has("sponsor")) {
    lines.push(
      "- Login plus one session plus sponsored gas: `/combo` and `/combo/react` (`createSponsoredSessionRoutes`, `useSponsoredSession`), built on `/session/kernel`, `/aa`, `/aa/kernel` and `/paymaster`.",
    );
  } else if (has("session")) {
    lines.push(
      "- Session signers (grant once, no popup per action): `/session` (`buildSessionPolicy`, `describeSessionScope`), `/session/server` (`createSessionRoutes`, `createSessionActionRoute`), `/session/react` (`useSessionGrant`, `useSessionAct`, `useSessionRevoke`).",
    );
  } else if (has("sponsor")) {
    lines.push(
      "- Sponsored transactions: `/aa` (`describeUserOpFailure`, bundler and paymaster clients), `/aa/react` (`useSponsoredSend`, `usePepuSmartAccount`, `usePepuSponsorship`), `/paymaster` (project balance, deposits).",
    );
  }
  lines.push("- Readiness check: `/doctor` (`runDoctor`, with `privyDashboardChecker`), used by `scripts/doctor.mjs`.");
  return lines.join("\n");
}

export function renderBlock(base, entry) {
  const dashboard = entry.privyDashboard.length
    ? `Privy dashboard settings this template needs:\n\n${entry.privyDashboard
        .map((id) => `- ${DASHBOARD[id] ?? id}`)
        .join("\n")}\n\n`
    : "";
  const steps = entry.extraSteps.length
    ? `Extra steps:\n\n${entry.extraSteps
        .map((s) => `- ${s.replace(/\{run:([a-z-]+)\}/g, "`npm run $1`")}`)
        .join("\n")}\n\n`
    : "";
  const vars = {
    name: entry.name,
    title: entry.title,
    features: code(entry.features),
    sdkSubpaths: sdkSubpaths(entry.features),
    requiredEnv: code(entry.requiredEnv),
    optionalEnv: entry.optionalEnv.length ? code(entry.optionalEnv) : "none",
    privyDashboard: dashboard,
    extraSteps: steps,
  };
  const body = base.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`unknown placeholder {{${k}}}`);
    return vars[k];
  });
  return `${BEGIN}\n\n${body.trim()}\n\n${END}`;
}

/** Insert or replace the kit block in an AGENTS.md body. */
export function applyBlock(existing, block) {
  const start = existing.indexOf(BEGIN);
  const end = existing.indexOf(END);
  if (start !== -1 && end > start) {
    return existing.slice(0, start) + block + existing.slice(end + END.length);
  }
  const next = existing.indexOf(NEXT_BLOCK);
  if (next !== -1) return `${existing.slice(0, next)}${block}\n\n${existing.slice(next)}`;
  return `${existing.replace(/\s*$/, "")}\n\n${block}\n`;
}

export async function loadRegistry() {
  return JSON.parse(await readFile(registryPath, "utf8"));
}

export async function expectedAgentsMd(template, existing) {
  const registry = await loadRegistry();
  const entry = registry.find((e) => e.name === template);
  if (!entry) throw new Error(`${template} missing from templates.json`);
  const base = await readFile(path.join(templatesRoot, "_agent", "AGENTS.base.md"), "utf8");
  return applyBlock(existing, renderBlock(base.replace(/\r\n/g, "\n"), entry));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const template of TEMPLATES) {
    for (const rel of VERBATIM) {
      const to = path.join(templatesRoot, template, rel);
      await mkdir(path.dirname(to), { recursive: true });
      await copyFile(path.join(templatesRoot, "_agent", rel), to);
    }
    const agents = path.join(templatesRoot, template, "AGENTS.md");
    const existing = await readFile(agents, "utf8");
    await writeFile(agents, await expectedAgentsMd(template, existing));
    console.log(`synced agent kit into ${template}`);
  }
}
