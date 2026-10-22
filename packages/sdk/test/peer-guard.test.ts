import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// @ts-expect-error plain .mjs data module shared with the build script, no type declarations.
import { PEER_REQUIREMENTS } from "../scripts/peer-requirements.mjs";

const pkgDir = fileURLToPath(new URL("..", import.meta.url));
const requirements = PEER_REQUIREMENTS as Record<string, { file: string; peers: string[] }>;
const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf-8")) as {
  exports: Record<string, { node?: { import: string }; import: string } | string>;
};

let isolated = "";

describe("peer-dependency guards (after build)", () => {
  beforeAll(() => {
    // Copy dist next to nothing else: no node_modules, so every peer is missing.
    isolated = mkdtempSync(path.join(tmpdir(), "pepu-sdk-peers-"));
    cpSync(path.join(pkgDir, "dist"), path.join(isolated, "dist"), { recursive: true });
    writeFileSync(path.join(isolated, "package.json"), JSON.stringify({ type: "module" }));
  });
  afterAll(() => {
    if (isolated) rmSync(isolated, { recursive: true, force: true });
  });

  it.each(Object.entries(requirements))("%s: ESM guard names the subpath and the npm i command", (subpath, req) => {
    const guard = path.join(isolated, "dist", `${req.file}.guard.js`);
    expect(existsSync(guard)).toBe(true);
    let stderr = "";
    try {
      execFileSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(guard).href)})`], {
        cwd: isolated,
        env: { ...process.env, NODE_PATH: "" },
        stdio: "pipe",
      });
    } catch (e) {
      stderr = String((e as { stderr?: Buffer }).stderr ?? "");
    }
    expect(stderr).toContain(`@pepu-chain/sdk/${subpath.slice(2)}`);
    expect(stderr).toContain(`npm i ${req.peers.join(" ")}`);
    expect(stderr).toContain("npx create-pepu-app");
    if (req.peers.includes("react")) expect(req.peers).toContain("react-dom");
    if (req.peers.includes("@privy-io/react-auth")) expect(stderr).toContain('"overrides": { "viem": "$viem" }');
    expect(stderr).not.toContain("imported from");
  }, 30_000);

  it.each(Object.entries(requirements).filter(([subpath]) => subpath !== "./privy/wagmi"))(
    "%s: CJS guard names the subpath and the npm i command",
    (subpath, req) => {
      const entry = path.join(isolated, "dist", `${req.file}.cjs`);
      let stderr = "";
      try {
        execFileSync(process.execPath, ["-e", `require(${JSON.stringify(entry)})`], { cwd: isolated, stdio: "pipe", env: { ...process.env, NODE_PATH: "" } });
      } catch (e) {
        stderr = String((e as { stderr?: Buffer }).stderr ?? "");
      }
      expect(stderr).toContain(`@pepu-chain/sdk/${subpath.slice(2)}`);
      expect(stderr).toContain(`npm i ${req.peers.join(" ")}`);
    },
    30_000,
  );

  it("every guarded subpath maps the guard under the node condition only, and the plain entry stays", () => {
    for (const [subpath, req] of Object.entries(requirements)) {
      const entry = pkg.exports[subpath];
      expect(typeof entry, subpath).toBe("object");
      const e = entry as { node?: { import: string }; import: string };
      expect(e.node?.import, subpath).toBe(`./dist/${req.file}.guard.js`);
      expect(e.import, subpath).toBe(`./dist/${req.file}.js`);
    }
  });

  it.each(Object.entries(requirements))("%s: with peers installed the guard loads and re-exports the entry", async (_subpath, req) => {
    const viaGuard = (await import(pathToFileURL(path.join(pkgDir, "dist", `${req.file}.guard.js`)).href)) as Record<string, unknown>;
    const direct = (await import(pathToFileURL(path.join(pkgDir, "dist", `${req.file}.js`)).href)) as Record<string, unknown>;
    expect(Object.keys(viaGuard).sort()).toEqual(Object.keys(direct).sort());
  }, 30_000);

  it("README and reference install tables list the same peers as the guards", () => {
    for (const rel of ["README.md", "../../docs/sdk/reference.md"]) {
      const text = readFileSync(path.join(pkgDir, rel), "utf-8");
      for (const [subpath, req] of Object.entries(requirements)) {
        expect(text, `${rel} ${subpath}`).toContain(`npm i ${req.peers.join(" ")}`);
      }
    }
  });
});
