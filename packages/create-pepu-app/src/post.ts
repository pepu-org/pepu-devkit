import { spawn, spawnSync } from "node:child_process";
import { installArgs, type PackageManagerName } from "./package-manager.js";

/**
 * Installs dependencies. `quiet` sends the package manager's output to stderr
 * so stdout stays clean for `--json`. Resolves true on exit code 0.
 */
export function runInstall(cwd: string, pm: PackageManagerName, quiet: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(pm, installArgs(pm), {
      cwd,
      stdio: quiet ? ["ignore", process.stderr, process.stderr] : "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export type GitInitResult = { initialized: true } | { initialized: false; reason: string };

/** `git init`, unless git is missing or the directory is already inside a work tree. */
export function gitInit(cwd: string): GitInitResult {
  const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, encoding: "utf8" });
  if (inside.error) return { initialized: false, reason: "git is not installed" };
  if (inside.status === 0 && inside.stdout.trim() === "true") {
    return { initialized: false, reason: "already inside a git repository" };
  }
  const init = spawnSync("git", ["init", "--quiet"], { cwd, encoding: "utf8" });
  return init.status === 0 ? { initialized: true } : { initialized: false, reason: "git init failed" };
}
