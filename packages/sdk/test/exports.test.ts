import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const pkgDir = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf-8")) as {
  exports: Record<string, string | { types: string; import: string; require?: string }>;
};

const subpaths = Object.entries(pkg.exports).flatMap(([key, value]) =>
  typeof value === "string" ? [] : [{ key, ...value }],
);

const EXPECTED_SUBPATHS = [
  ".",
  "./react",
  "./privy",
  "./privy/react",
  "./privy/wagmi",
  "./privy/server",
  "./session",
  "./session/server",
  "./session/react",
  "./session/kernel",
  "./aa",
  "./aa/kernel",
  "./aa/react",
  "./aa/react-direct",
  "./paymaster",
  "./paymaster/server",
  "./combo",
  "./combo/react",
  "./server",
  "./doctor",
];

/**
 * ESM-only subpaths. `./privy/wagmi` re-exports `@privy-io/wagmi`, which ships
 * no CJS build, so it has no `require` condition and is exempt from the CJS
 * file and load assertions.
 */
const ESM_ONLY = new Set(["./privy/wagmi"]);

const abs = (file: string): string => path.join(pkgDir, file);

describe("package exports (after build)", () => {
  beforeAll(() => {
    // Build only when dist is missing, so a plain `vitest run` on a fresh
    // checkout still works.
    const missing = subpaths.some((s) => !existsSync(abs(s.import)));
    if (missing) execSync("pnpm exec tsup", { cwd: pkgDir, stdio: "pipe" });
  }, 180_000);

  it("exports every subpath in the plan", () => {
    expect(subpaths.map((s) => s.key).sort()).toEqual([...EXPECTED_SUBPATHS].sort());
    expect(pkg.exports["./package.json"]).toBe("./package.json");
  });

  it.each(subpaths.map((s) => [s.key, s] as const))("%s: types, esm and cjs files exist", (_key, s) => {
    const files = ESM_ONLY.has(_key) ? [s.types, s.import] : [s.types, s.import, s.require];
    for (const file of files) {
      expect(file, `${_key} file`).toBeTypeOf("string");
      expect(existsSync(abs(file as string)), String(file)).toBe(true);
    }
    // Both directions: ESM-only means no `require` condition, everything else has one.
    expect(s.require === undefined, `${_key} require condition`).toBe(ESM_ONLY.has(_key));
  });

  it.each(subpaths.map((s) => [s.key, s] as const))("%s: loads as ESM and CJS", async (_key, s) => {
    const esm: unknown = await import(pathToFileURL(abs(s.import)).href);
    expect(esm).toBeTypeOf("object");
    if (ESM_ONLY.has(_key)) return; // see ESM_ONLY: @privy-io/wagmi has no CJS export.
    const cjs: unknown = createRequire(import.meta.url)(abs(s.require as string));
    expect(cjs).toBeTypeOf("object");
  });

  it("aa/react never references @zerodev, even through a lazy chunk (Privy Smart Wallets users need no ZeroDev)", () => {
    // Follow static and dynamic relative imports: bundlers resolve import() at build time too.
    const staticGraph = (entry: string): Set<string> => {
      const seen = new Set<string>();
      const externals = new Set<string>();
      const walk = (file: string): void => {
        if (seen.has(file)) return;
        seen.add(file);
        const text = readFileSync(file, "utf-8");
        const re = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(["']([^"']+)["']\)/g;
        for (const m of text.matchAll(re)) {
          const spec = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
          if (spec === undefined) continue;
          if (spec.startsWith(".")) walk(path.resolve(path.dirname(file), spec));
          else externals.add(spec);
        }
      };
      walk(abs(entry));
      return externals;
    };
    for (const entry of ["dist/aa/react.js", "dist/aa/react.cjs"]) {
      const externals = [...staticGraph(entry)];
      expect(externals.filter((e) => e.startsWith("@zerodev/")), entry).toEqual([]);
    }
  });

  it("the root entry exposes the same export names in ESM and CJS", async () => {
    const esm = (await import(pathToFileURL(abs("dist/index.js")).href)) as object;
    const cjs = createRequire(import.meta.url)(abs("dist/index.cjs")) as object;
    expect(Object.keys(cjs).sort()).toEqual(Object.keys(esm).filter((k) => k !== "default").sort());
  });

  it("./privy and ./server keep their 0.1 export names", async () => {
    const privy = (await import(pathToFileURL(abs("dist/privy.js")).href)) as object;
    expect(privy).toHaveProperty("createPepuPrivyConfig");
    const server = (await import(pathToFileURL(abs("dist/server.js")).href)) as object;
    for (const name of [
      "PRIVY_POLICY_NAME_MAX_LENGTH",
      "assertWithinPolicyNameLimit",
      "broadcastSignedTransaction",
      "buildSessionPolicy",
      "signAndBroadcast",
      "withGasLimitBuffer",
    ]) {
      expect(server, name).toHaveProperty(name);
    }
  });

  it("publint reports no errors", async () => {
    const { publint } = await import("publint");
    const { messages } = await publint({ pkgDir, level: "error", strict: false });
    expect(messages).toEqual([]);
  });
});
