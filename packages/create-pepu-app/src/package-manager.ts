export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;

export type PackageManagerName = (typeof PACKAGE_MANAGERS)[number];

export function isPackageManagerName(value: string): value is PackageManagerName {
  return (PACKAGE_MANAGERS as readonly string[]).includes(value);
}

/**
 * Guesses the package manager the user is already using from the
 * `npm_config_user_agent` environment variable — set by npm, pnpm, yarn,
 * and bun themselves when they run a script (including `npx`/`create-*`
 * invocations). Falls back to `npm` when the variable is absent or
 * unrecognized (e.g. the CLI was run directly via `node dist/index.js`).
 */
export function detectPackageManager(): PackageManagerName {
  const userAgent = process.env.npm_config_user_agent;
  if (!userAgent) return "npm";

  if (userAgent.startsWith("pnpm")) return "pnpm";
  if (userAgent.startsWith("yarn")) return "yarn";
  if (userAgent.startsWith("bun")) return "bun";
  return "npm";
}

export function installCommand(pm: PackageManagerName): string {
  switch (pm) {
    case "npm":
      return "npm install";
    case "pnpm":
      return "pnpm install";
    case "yarn":
      return "yarn";
    case "bun":
      return "bun install";
  }
}

/** Arguments for a dependency install (`yarn` alone installs). */
export function installArgs(pm: PackageManagerName): string[] {
  return pm === "yarn" ? [] : ["install"];
}

export function runScriptCommand(pm: PackageManagerName, script: string): string {
  switch (pm) {
    case "npm":
      return `npm run ${script}`;
    case "pnpm":
      return `pnpm ${script}`;
    case "yarn":
      return `yarn ${script}`;
    case "bun":
      return `bun run ${script}`;
  }
}
