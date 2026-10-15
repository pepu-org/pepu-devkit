import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scaffold } from "../src/scaffold.js";
import { TEMPLATES } from "../src/templates.js";

/**
 * These exercise the real bundled `templates/consumer-app` and
 * `vendor/pepu-sdk` assets (kept up to date by `pnpm sync` /
 * `npm run pretest`), not fakes — the thing this package actually
 * ships is what gets tested.
 */
describe("scaffold", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), "create-pepu-app-scaffold-test-"));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("copies the template and rewrites package.json's name", async () => {
    const targetDir = path.join(tmpRoot, "my-new-app");

    const result = await scaffold({
      sdk: "vendor",
      targetDir,
      projectName: "My New App",
      template: "consumer-app",
      packageManager: "npm",
    });

    expect(result.targetDir).toBe(targetDir);
    expect(existsSync(path.join(targetDir, "package.json"))).toBe(true);
    expect(existsSync(path.join(targetDir, "app", "page.tsx"))).toBe(true);

    const pkg = JSON.parse(await readFile(path.join(targetDir, "package.json"), "utf8"));
    expect(pkg.name).toBe("my-new-app");
  });

  it("rewrites the @pepu-chain/sdk dependency to a vendored file: reference and copies it in", async () => {
    const targetDir = path.join(tmpRoot, "sdk-check");

    const result = await scaffold({
      sdk: "vendor",
      targetDir,
      projectName: "sdk-check",
      template: "consumer-app",
      packageManager: "npm",
    });

    expect(result.vendoredSdk).toBe(true);

    const pkg = JSON.parse(await readFile(path.join(targetDir, "package.json"), "utf8"));
    expect(pkg.dependencies["@pepu-chain/sdk"]).toBe("file:./vendor/pepu-sdk");
    expect(existsSync(path.join(targetDir, "vendor", "pepu-sdk", "package.json"))).toBe(true);
    expect(existsSync(path.join(targetDir, "vendor", "pepu-sdk", "dist"))).toBe(true);
  });

  it("generates .env.local from .env.example", async () => {
    const targetDir = path.join(tmpRoot, "env-check");

    await scaffold({
      sdk: "vendor",
      targetDir,
      projectName: "env-check",
      template: "consumer-app",
      packageManager: "npm",
    });

    expect(existsSync(path.join(targetDir, ".env.local"))).toBe(true);
    const example = await readFile(path.join(targetDir, ".env.example"), "utf8");
    const local = await readFile(path.join(targetDir, ".env.local"), "utf8");
    // Header with the network details, then the example verbatim.
    expect(local).toContain("chainId 97741");
    expect(local).toContain(example.trimEnd().split("\n")[0] as string);
    expect(local).not.toContain("NEXT_PUBLIC_PEPU_NETWORK");
  });

  it("throws a clear error for an unknown template", async () => {
    await expect(
      scaffold({
        sdk: "vendor",
        targetDir: path.join(tmpRoot, "nope"),
        projectName: "nope",
        template: "does-not-exist",
        packageManager: "npm",
      }),
    ).rejects.toThrow(/does-not-exist/);
  });

  describe.each(TEMPLATES.map((t) => t.name).filter((n) => n !== "consumer-app"))(
    "template: %s",
    (template) => {
      it("copies the template, rewrites package.json, and vendors @pepu-chain/sdk", async () => {
        const targetDir = path.join(tmpRoot, template);

        const result = await scaffold({
          sdk: "vendor",
          targetDir,
          projectName: `test-${template}`,
          template,
          packageManager: "npm",
        });

        expect(existsSync(path.join(targetDir, "package.json"))).toBe(true);
        expect(existsSync(path.join(targetDir, "app", "page.tsx"))).toBe(true);
        expect(existsSync(path.join(targetDir, ".env.local"))).toBe(true);

        const pkg = JSON.parse(await readFile(path.join(targetDir, "package.json"), "utf8"));
        expect(pkg.name).toBe(`test-${template}`);

        expect(result.vendoredSdk).toBe(true);
        expect(pkg.dependencies["@pepu-chain/sdk"]).toBe("file:./vendor/pepu-sdk");
        expect(existsSync(path.join(targetDir, "vendor", "pepu-sdk", "package.json"))).toBe(true);
      });
    },
  );
});
