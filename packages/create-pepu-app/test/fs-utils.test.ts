import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isSafeTargetDir, toPackageName } from "../src/fs-utils.js";

describe("toPackageName", () => {
  it("lowercases and hyphenates", () => {
    expect(toPackageName("My Cool App")).toBe("my-cool-app");
  });

  it("strips characters npm package names disallow", () => {
    expect(toPackageName("Weird!! Name@@2024")).toBe("weird-name-2024");
  });

  it("collapses repeated separators", () => {
    expect(toPackageName("a---b   c")).toBe("a-b-c");
  });

  it("strips a leading dot or hyphen", () => {
    expect(toPackageName(".hidden-app")).toBe("hidden-app");
    expect(toPackageName("-app")).toBe("app");
  });

  it("falls back to a default when nothing is left", () => {
    expect(toPackageName("!!!")).toBe("pepu-app");
    expect(toPackageName("")).toBe("pepu-app");
  });
});

describe("isSafeTargetDir", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), "create-pepu-app-test-"));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("is safe when the directory doesn't exist yet", async () => {
    expect(await isSafeTargetDir(path.join(tmpRoot, "does-not-exist"))).toBe(true);
  });

  it("is safe when the directory exists but is empty", async () => {
    const dir = path.join(tmpRoot, "empty");
    await mkdir(dir);
    expect(await isSafeTargetDir(dir)).toBe(true);
  });

  it("is not safe when the directory has files in it", async () => {
    const dir = path.join(tmpRoot, "occupied");
    await mkdir(dir);
    await writeFile(path.join(dir, "file.txt"), "hi");
    expect(await isSafeTargetDir(dir)).toBe(false);
  });
});
