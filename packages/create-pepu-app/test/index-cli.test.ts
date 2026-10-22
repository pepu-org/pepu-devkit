import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Spawns the real CLI entrypoint (via tsx, same as the `dev` script) as a
 * child process, the way an actual user invokes it — as opposed to
 * scaffold.test.ts, which calls `scaffold()` directly with an
 * already-resolved `projectName`. This is the only place that exercises
 * `main()`'s own argument-to-projectName resolution in src/index.ts.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.join(here, "..");
const cliEntry = path.join(packageRoot, "src", "index.ts");
const tsxBin = path.join(packageRoot, "node_modules", "tsx", "dist", "cli.mjs");

function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, [tsxBin, cliEntry, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
  });
}

describe("create-pepu-app CLI entrypoint (spawned, non-interactive)", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), "create-pepu-app-cli-test-"));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("names package.json after the directory's basename, not the whole path, for a nested relative directory", async () => {
    // Regression test. main() used to compute `defaultProjectName` as the
    // basename of the resolved directory, but then fall back to the *raw*
    // `args.directory` (not `defaultProjectName`) as the non-interactive
    // projectName. Any directory argument containing a path separator —
    // "./apps/my-app", or any absolute path — got its every segment
    // slugified into package.json's "name" instead of just the leaf name.
    const relDir = path.join("apps", "my-app");
    const result = runCli([relDir, "--template", "consumer-app", "--yes", "--no-install", "--no-git", "--pm", "npm"], tmpRoot);

    expect(result.status).toBe(0);

    const pkg = JSON.parse(
      await readFile(path.join(tmpRoot, "apps", "my-app", "package.json"), "utf8"),
    );
    expect(pkg.name).toBe("my-app");
  });

  it("names package.json after the basename for an absolute directory argument", async () => {
    const targetDir = path.join(tmpRoot, "nested", "the-app");
    const result = runCli(
      [targetDir, "--template", "consumer-app", "--yes", "--no-install", "--no-git", "--pm", "npm"],
      tmpRoot,
    );

    expect(result.status).toBe(0);

    const pkg = JSON.parse(await readFile(path.join(targetDir, "package.json"), "utf8"));
    expect(pkg.name).toBe("the-app");
  });

  it("defaults the project name to pepu-app when no directory is given", async () => {
    const result = runCli(["--yes", "--no-install", "--no-git", "--pm", "npm"], tmpRoot);

    expect(result.status).toBe(0);

    const pkg = JSON.parse(await readFile(path.join(tmpRoot, "pepu-app", "package.json"), "utf8"));
    expect(pkg.name).toBe("pepu-app");
  });

  it("exits non-zero and lists templates for an unknown --template", () => {
    const result = runCli(
      ["some-dir", "--template", "not-a-real-template", "--yes"],
      tmpRoot,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Unknown template "not-a-real-template"/);
    expect(result.stdout).toMatch(/consumer-app/);
    expect(result.stdout).toMatch(/token-gated-app/);
    expect(result.stdout).toMatch(/nft-mint/);
    expect(result.stdout).toMatch(/game-app/);
    expect(result.stdout).toMatch(/sponsored-demo/);
    expect(result.stdout).toMatch(/sponsored-session-app/);
  });
});

describe("create-pepu-app CLI --json and non-interactive modes", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), "create-pepu-app-json-test-"));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  const common = ["--yes", "--no-install", "--no-git", "--json", "--pm", "npm", "--sdk", "vendor"];

  it("default --sdk is npm; with the SDK unpublished it falls back to vendor and says so", () => {
    const dir = path.join(tmpRoot, "default-sdk");
    const result = runCli([dir, "--yes", "--no-install", "--no-git", "--json", "--pm", "npm"], tmpRoot);
    expect(result.status, result.stderr).toBe(0);
    const out = JSON.parse(result.stdout);
    if (out.sdk.fellBackToVendor) {
      expect(out.sdk).toMatchObject({ mode: "vendor", spec: "file:./vendor/pepu-sdk" });
    } else {
      expect(out.sdk.mode).toBe("npm");
      expect(out.sdk.spec).toMatch(/^\^\d+\.\d+\.\d+/);
    }
  }, 60_000);

  it("emits exactly one valid JSON document on stdout for every template", async () => {
    const { TEMPLATES } = await import("../src/templates.js");
    for (const t of TEMPLATES) {
      const dir = path.join(tmpRoot, t.name);
      const result = runCli([dir, "--template", t.name, ...common], tmpRoot);
      expect(result.status, `${t.name}: ${result.stderr}`).toBe(0);

      const out = JSON.parse(result.stdout);
      expect(out.ok).toBe(true);
      expect(out.template).toBe(t.name);
      expect(out.path).toBe(path.resolve(dir));
      expect(out.features).toEqual(t.features);
      expect(out.installed).toBe(false);
      expect(out.gitInitialized).toBe(false);
      expect(out.sdk).toMatchObject({ mode: "vendor", spec: "file:./vendor/pepu-sdk" });
      expect(out.requiredEnv.map((e: { key: string }) => e.key)).toEqual(t.requiredEnv);
      expect(out.missingEnv.length).toBeGreaterThan(0);
      expect(out.nextSteps.length).toBeGreaterThan(2);
      expect(out.privyDashboard.length).toBeGreaterThan(0);
      expect(Array.isArray(out.agentFiles)).toBe(true);
    }
  });

  it("never prints env values in --json output, and leaves secrets blank in .env.local", async () => {
    const dir = path.join(tmpRoot, "secrets");
    const result = runCli([dir, "--template", "sponsored-session-app", ...common], tmpRoot);
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout);
    const env = await readFile(path.join(dir, ".env.local"), "utf8");
    expect(env).toMatch(/^PRIVY_APP_SECRET=$/m);
    expect(env).toMatch(/^PEPU_PAYMASTER_URL=$/m);
    expect(env).toContain("chainId 97741");
    expect(out.requiredEnv.find((e: { key: string }) => e.key === "PRIVY_APP_SECRET").secret).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/ngrok/i);
  });

  it("--json failures are JSON too (unknown template, non-empty dir) with exit code 1", async () => {
    const unknown = runCli([path.join(tmpRoot, "u"), "--template", "nope", ...common], tmpRoot);
    expect(unknown.status).toBe(1);
    const u = JSON.parse(unknown.stdout);
    expect(u.ok).toBe(false);
    expect(u.templates).toContain("consumer-app");

    const dir = path.join(tmpRoot, "taken");
    expect(runCli([dir, ...common], tmpRoot).status).toBe(0);
    const again = runCli([dir, ...common], tmpRoot);
    expect(again.status).toBe(1);
    expect(JSON.parse(again.stdout)).toMatchObject({ ok: false });
  });

  it("--json with a bad flag reports JSON", () => {
    const result = runCli(["--json", "--sdk", "bogus"], tmpRoot);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).ok).toBe(false);
  });

  it("--skip-agent-files drops agent files; the non-JSON path prints tailored next steps", async () => {
    const dir = path.join(tmpRoot, "plain");
    const result = runCli(
      [dir, "--template", "game-app", "--yes", "--no-install", "--no-git", "--skip-agent-files", "--pm", "pnpm"],
      tmpRoot,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Next steps/);
    expect(result.stdout).toMatch(/pnpm install/);
    expect(result.stdout).toMatch(/PRIVY_AUTHORIZATION_KEY/);
    expect(result.stdout).toMatch(/pnpm generate-authorization-key/);
    await expect(readFile(path.join(dir, "AGENTS.md"), "utf8")).rejects.toThrow();
  });

  it("--list --json lists all six templates with metadata", () => {
    const result = runCli(["--list", "--json"], tmpRoot);
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout);
    expect(out.templates).toHaveLength(6);
    expect(out.templates[0]).toHaveProperty("features");
  });

  it("--git initialises a repository in the scaffold", async () => {
    const dir = path.join(tmpRoot, "gitty");
    const result = runCli([dir, "--yes", "--no-install", "--git", "--json", "--pm", "npm"], tmpRoot);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).gitInitialized).toBe(true);
    await expect(readFile(path.join(dir, ".git", "HEAD"), "utf8")).resolves.toMatch(/ref:/);
  });
});
