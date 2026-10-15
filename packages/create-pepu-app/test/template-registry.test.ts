import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import registry from "../src/templates.json";
import { TEMPLATE_REQUIREMENTS } from "@pepu-chain/sdk/doctor";
import { PEPU_PRIVY_REQUIREMENTS } from "@pepu-chain/sdk/privy";
import { TEMPLATES } from "../src/templates.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.join(here, "..");
const sourceTemplates = path.join(packageRoot, "..", "..", "templates");

/** Non-template entries that live beside the real templates. */
const NON_TEMPLATE_DIRS = new Set(["_design", "_agent", "scripts", "node_modules"]);

const templateDirsOnDisk = readdirSync(sourceTemplates)
  .filter((n) => statSync(path.join(sourceTemplates, n)).isDirectory() && !NON_TEMPLATE_DIRS.has(n))
  .sort();

describe("template registry", () => {
  it("TEMPLATES in templates.ts is exactly src/templates.json", () => {
    expect(TEMPLATES.map((t) => t.name)).toEqual(registry.map((t) => t.name));
  });

  it("every directory in templates/ is registered", () => {
    const registered = new Set(registry.map((t) => t.name));
    const missing = templateDirsOnDisk.filter((n) => !registered.has(n));
    expect(missing, `templates/ dirs not in src/templates.json: ${missing.join(", ")}`).toEqual([]);
  });

  it("every registered template exists in templates/ and is vendored", () => {
    for (const { name } of registry) {
      expect(existsSync(path.join(sourceTemplates, name, "package.json")), `templates/${name}`).toBe(true);
      expect(
        existsSync(path.join(packageRoot, "templates", name, "package.json")),
        `vendored ${name} (run pnpm sync)`,
      ).toBe(true);
    }
  });

  it("registers the six templates, including sponsored-session-app", () => {
    expect(registry.map((t) => t.name).sort()).toEqual(
      [
        "consumer-app",
        "game-app",
        "nft-mint",
        "sponsored-demo",
        "sponsored-session-app",
        "token-gated-app",
      ].sort(),
    );
  });

  it("sync-assets.mjs derives its list from templates.json", async () => {
    const script = await readFile(path.join(packageRoot, "scripts", "sync-assets.mjs"), "utf8");
    expect(script).toMatch(/templates\.json/);
  });

  it("has unique names, non-empty descriptions, and a registered default", () => {
    const names = registry.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of registry) expect(t.description.trim().length).toBeGreaterThan(0);
    expect(names).toContain("consumer-app");
  });

  it("carries features, title, required env, dashboard keys and mcp:true for every template", () => {
    for (const t of TEMPLATES) {
      expect(t.title.length, t.name).toBeGreaterThan(0);
      expect(t.features.length, t.name).toBeGreaterThan(0);
      expect(t.features, t.name).toContain("login");
      expect(t.requiredEnv.length, t.name).toBeGreaterThan(0);
      expect(t.privyDashboard.length, t.name).toBeGreaterThan(0);
      expect(t.mcp, t.name).toBe(true);
    }
  });

  it("features match the claims: session for game and sponsored-session, sponsor for both sponsored", () => {
    const by = Object.fromEntries(TEMPLATES.map((t) => [t.name, t.features]));
    expect(by["game-app"]).toEqual(["login", "session"]);
    expect(by["sponsored-demo"]).toEqual(["login", "sponsor"]);
    expect(by["sponsored-session-app"]).toEqual(["login", "session", "sponsor"]);
  });

  it("agrees with TEMPLATE_REQUIREMENTS from @pepu-chain/sdk/doctor", () => {
    for (const t of TEMPLATES) {
      const req = TEMPLATE_REQUIREMENTS[t.name];
      expect(req, `SDK doctor has no entry for ${t.name}`).toBeDefined();
      expect(t.requiredEnv, t.name).toEqual(req?.requiredEnv);
      expect(t.optionalEnv, t.name).toEqual(req?.optionalEnv);
      expect(t.privyDashboard, t.name).toEqual(req?.privyDashboard);
    }
  });

  it("every Privy dashboard key resolves in PEPU_PRIVY_REQUIREMENTS", () => {
    const ids = new Set(PEPU_PRIVY_REQUIREMENTS.map((r) => r.id));
    for (const t of TEMPLATES) {
      for (const key of t.privyDashboard) expect(ids.has(key), `${t.name}: ${key}`).toBe(true);
    }
  });
});
