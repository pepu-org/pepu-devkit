import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scaffold } from "../src/scaffold.js";
import { buildEnvLocal, parseEnv } from "../src/env.js";

describe("scaffold: sdk modes, agent files, env prefill", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), "create-pepu-app-extra-test-"));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  const base = { projectName: "x", template: "consumer-app", packageManager: "npm" } as const;

  it("--sdk npm writes a semver range, skips vendoring, when the SDK is published", async () => {
    const targetDir = path.join(tmpRoot, "npm-mode");
    const result = await scaffold({ ...base, targetDir, sdk: "npm", npmHasSdk: () => true });

    expect(result.sdkMode).toBe("npm");
    expect(result.sdkFellBack).toBe(false);
    expect(result.vendoredSdk).toBe(false);
    expect(existsSync(path.join(targetDir, "vendor"))).toBe(false);
    const pkg = JSON.parse(await readFile(path.join(targetDir, "package.json"), "utf8"));
    expect(pkg.dependencies["@pepu-chain/sdk"]).toMatch(/^\^\d+\.\d+\.\d+/);
  });

  it("--sdk npm falls back to vendor when the SDK is not on npm (or offline)", async () => {
    const targetDir = path.join(tmpRoot, "npm-fallback");
    const result = await scaffold({ ...base, targetDir, sdk: "npm", npmHasSdk: () => false });

    expect(result.sdkMode).toBe("vendor");
    expect(result.sdkFellBack).toBe(true);
    expect(result.vendoredSdk).toBe(true);
    const pkg = JSON.parse(await readFile(path.join(targetDir, "package.json"), "utf8"));
    expect(pkg.dependencies["@pepu-chain/sdk"]).toBe("file:./vendor/pepu-sdk");
  });

  it("checks npm for the exact vendored SDK version, not just the package", async () => {
    const targetDir = path.join(tmpRoot, "npm-version");
    const asked: string[] = [];
    const result = await scaffold({
      ...base,
      targetDir,
      sdk: "npm",
      npmHasSdk: (version) => {
        asked.push(version);
        return false;
      },
    });

    const vendored = JSON.parse(await readFile(path.join(targetDir, "vendor", "pepu-sdk", "package.json"), "utf8"));
    expect(asked).toEqual([vendored.version]);
    expect(result.sdkMode).toBe("vendor");
    expect(result.sdkFellBack).toBe(true);
  });

  it("--sdk vendor does not consult npm", async () => {
    const result = await scaffold({
      ...base,
      sdk: "vendor",
      targetDir: path.join(tmpRoot, "vendor-explicit"),
      npmHasSdk: () => {
        throw new Error("npm must not be consulted in vendor mode");
      },
    });
    expect(result.sdkMode).toBe("vendor");
  });

  it("defaults to npm when the SDK is published, and falls back cleanly when not", async () => {
    const published = await scaffold({ ...base, targetDir: path.join(tmpRoot, "d1"), npmHasSdk: () => true });
    expect(published.sdkMode).toBe("npm");
    const pkg = JSON.parse(await readFile(path.join(tmpRoot, "d1", "package.json"), "utf8"));
    expect(pkg.dependencies["@pepu-chain/sdk"]).toMatch(/^\^\d+\.\d+\.\d+/);
    const missing = await scaffold({ ...base, targetDir: path.join(tmpRoot, "d2"), npmHasSdk: () => false });
    expect(missing.sdkMode).toBe("vendor");
    expect(missing.sdkFellBack).toBe(true);
  });

  it("every export path of the vendored SDK resolves from a scaffolded dir", async () => {
    const targetDir = path.join(tmpRoot, "exports");
    await scaffold({ ...base, targetDir, sdk: "vendor" });
    const sdkDir = path.join(targetDir, "vendor", "pepu-sdk");
    const pkg = JSON.parse(readFileSync(path.join(sdkDir, "package.json"), "utf8")) as {
      exports: Record<string, string | Record<string, string | Record<string, string>>>;
      peerDependenciesMeta?: unknown;
    };
    const missing: string[] = [];
    for (const [subpath, target] of Object.entries(pkg.exports)) {
      // Conditions can nest (the `node` condition maps a peer-guard entry).
      const flatten = (t: string | Record<string, unknown>): string[] =>
        typeof t === "string" ? [t] : Object.values(t).flatMap((v) => flatten(v as string | Record<string, unknown>));
      const files = flatten(target);
      for (const f of files) {
        if (!existsSync(path.join(sdkDir, f))) missing.push(`${subpath} -> ${f}`);
      }
    }
    expect(missing).toEqual([]);
    expect(Object.keys(pkg.exports)).toContain("./doctor");
    expect(pkg.peerDependenciesMeta).toBeDefined();
  });

  it("copies dotfiles and agent files that live inside a template", async () => {
    const targetDir = path.join(tmpRoot, "dotfiles");
    const result = await scaffold({ ...base, targetDir, sdk: "vendor" });
    expect(existsSync(path.join(targetDir, ".gitignore"))).toBe(true);
    expect(existsSync(path.join(targetDir, ".env.example"))).toBe(true);
    expect(existsSync(path.join(targetDir, "_gitignore"))).toBe(false);
    expect(result.agentFiles).toContain("AGENTS.md");
  });

  it("fills in missing agent files from the shared kit, never overwriting the template's own", async () => {
    const kit = path.join(tmpRoot, "kit");
    await mkdir(path.join(kit, ".cursor"), { recursive: true });
    await mkdir(path.join(kit, ".vscode"), { recursive: true });
    await writeFile(path.join(kit, ".vscode", "mcp.json"), "{}\n");
    await writeFile(path.join(kit, ".cursor", "mcp.json"), "{}\n");
    await writeFile(path.join(kit, "AGENTS.md"), "FROM KIT\n");

    const targetDir = path.join(tmpRoot, "kit-fill");
    const result = await scaffold({ ...base, targetDir, sdk: "vendor", agentKitDir: kit });

    expect(existsSync(path.join(targetDir, ".vscode", "mcp.json"))).toBe(true);
    expect(existsSync(path.join(targetDir, ".cursor", "mcp.json"))).toBe(true);
    expect(result.agentFiles).toEqual(expect.arrayContaining([".vscode/mcp.json", ".cursor/mcp.json", "AGENTS.md"]));
    // The template's own AGENTS.md wins over the kit's.
    expect(await readFile(path.join(targetDir, "AGENTS.md"), "utf8")).not.toBe("FROM KIT\n");
  });

  it("skipAgentFiles removes agent files and ignores the kit", async () => {
    const kit = path.join(tmpRoot, "kit2");
    await mkdir(kit, { recursive: true });
    await mkdir(path.join(kit, ".cursor"), { recursive: true });
    await writeFile(path.join(kit, ".cursor", "mcp.json"), "{}\n");

    const targetDir = path.join(tmpRoot, "skip");
    const result = await scaffold({ ...base, targetDir, sdk: "vendor", agentKitDir: kit, skipAgentFiles: true });

    expect(result.agentFiles).toEqual([]);
    expect(existsSync(path.join(targetDir, ".cursor", "mcp.json"))).toBe(false);
    expect(existsSync(path.join(targetDir, "AGENTS.md"))).toBe(false);
    expect(existsSync(path.join(targetDir, "package.json"))).toBe(true);
  });
});

describe("buildEnvLocal", () => {
  it("keeps secrets blank, and never invents values", () => {
    const example = [
      "# comment",
      "NEXT_PUBLIC_PRIVY_APP_ID=",
      "PRIVY_APP_SECRET=",
      "PEPU_RPC_URL=",
      "SESSION_DURATION_MINUTES=15",
    ].join("\n");
    const out = buildEnvLocal(example);
    const env = parseEnv(out);
    expect(env.NEXT_PUBLIC_PEPU_NETWORK).toBeUndefined();
    expect(env.NEXT_PUBLIC_PRIVY_APP_ID).toBe("");
    expect(env.PRIVY_APP_SECRET).toBe("");
    expect(env.PEPU_RPC_URL).toBe("");
    expect(env.SESSION_DURATION_MINUTES).toBe("15");
    expect(out).toContain("97741");
    expect(out).not.toMatch(/ngrok/i);
  });

  it("does not add variables the template did not declare", () => {
    expect(parseEnv(buildEnvLocal("FOO=\n"))).toEqual({ FOO: "" });
  });
});
