import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyTemplateTree } from "../scripts/sync-lib.mjs";
import { restoreDotfiles } from "../src/fs-utils.js";

describe("sync-assets template mirroring", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "create-pepu-app-sync-test-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  async function makeFixture(): Promise<string> {
    const src = path.join(tmp, "src");
    await mkdir(path.join(src, ".cursor"), { recursive: true });
    await mkdir(path.join(src, "node_modules", "x"), { recursive: true });
    await mkdir(path.join(src, "app"), { recursive: true });
    await writeFile(path.join(src, "package.json"), "{}\n");
    await writeFile(path.join(src, ".mcp.json"), '{"mcpServers":{}}\n');
    await writeFile(path.join(src, ".cursor", "mcp.json"), "{}\n");
    await writeFile(path.join(src, ".env.example"), "A=\n");
    await writeFile(path.join(src, ".env.local"), "SECRET=1\n");
    await writeFile(path.join(src, ".gitignore"), "node_modules\n");
    await writeFile(path.join(src, "app", ".gitignore"), "nested\n");
    await writeFile(path.join(src, "node_modules", "x", "index.js"), "");
    await writeFile(path.join(src, "debug.log"), "");
    return src;
  }

  it("copies hidden files and directories, drops build output and local secrets", async () => {
    const src = await makeFixture();
    const dest = path.join(tmp, "dest");
    await copyTemplateTree(src, dest);

    expect(existsSync(path.join(dest, ".mcp.json"))).toBe(true);
    expect(await readFile(path.join(dest, ".cursor", "mcp.json"), "utf8")).toBe("{}\n");
    expect(existsSync(path.join(dest, ".env.example"))).toBe(true);
    expect(existsSync(path.join(dest, ".env.local"))).toBe(false);
    expect(existsSync(path.join(dest, "node_modules"))).toBe(false);
    expect(existsSync(path.join(dest, "debug.log"))).toBe(false);
  });

  it("stores .gitignore as _gitignore (npm would not pack it) and the scaffolder restores it", async () => {
    const src = await makeFixture();
    const dest = path.join(tmp, "dest");
    await copyTemplateTree(src, dest);

    expect(existsSync(path.join(dest, ".gitignore"))).toBe(false);
    expect(existsSync(path.join(dest, "_gitignore"))).toBe(true);
    expect(existsSync(path.join(dest, "app", "_gitignore"))).toBe(true);

    await restoreDotfiles(dest);
    expect(await readFile(path.join(dest, ".gitignore"), "utf8")).toBe("node_modules\n");
    expect(existsSync(path.join(dest, "_gitignore"))).toBe(false);
  });

  it("the real synced templates keep their dotfiles", () => {
    const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    const mirrored = path.join(here, "..", "templates", "consumer-app");
    expect(existsSync(path.join(mirrored, ".env.example"))).toBe(true);
    expect(existsSync(path.join(mirrored, "_gitignore"))).toBe(true);
  });
});
