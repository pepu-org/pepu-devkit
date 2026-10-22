import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { quoteWindowsArg, resolveCommand } from "../src/exec.js";

describe("resolveCommand", () => {
  it("spawns the binary directly with shell false on posix", () => {
    expect(resolveCommand("npm", ["install", "--no-fund"], "linux")).toEqual({ command: "npm", args: ["install", "--no-fund"], shell: false });
    expect(resolveCommand("pnpm", ["install"], "darwin").shell).toBe(false);
  });

  it("never combines shell: true with an args array (DEP0190) on Windows", () => {
    const r = resolveCommand("npm", ["install", "--no-fund", "--no-audit"], "win32");
    expect(r).toEqual({ command: "npm install --no-fund --no-audit", args: [], shell: true });
  });

  it("quotes unsafe Windows arguments", () => {
    expect(quoteWindowsArg("a b")).toBe('"a b"');
    expect(quoteWindowsArg("x&y")).toBe('"x&y"');
    expect(quoteWindowsArg("")).toBe('""');
    expect(quoteWindowsArg("@pepu-chain/sdk")).toBe("@pepu-chain/sdk");
    expect(resolveCommand("npm", ["view", "a b"], "win32").command).toBe('npm view "a b"');
  });

  it("runs a real command on this platform without a DEP0190 warning", () => {
    const { command, args, shell } = resolveCommand("npm", ["--version"]);
    const res = spawnSync(command, args, { encoding: "utf8", shell, env: { ...process.env, NODE_OPTIONS: "--throw-deprecation" } });
    expect(res.stderr).not.toMatch(/DEP0190/);
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  }, 30_000);
});
