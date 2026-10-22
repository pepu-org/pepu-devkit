import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import registry from "../src/templates.json";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.join(here, "..");
const canonicalDir = path.join(packageRoot, "..", "..", "templates", "_design");

const TEMPLATES = registry.map((t) => t.name);
const SHARED: [string, string][] = [
  ["pepu-design.css", "app/pepu-design.css"],
  ["pepu-mark.tsx", "components/pepu-mark.tsx"],
  ["success-check.tsx", "components/success-check.tsx"],
  ["copy-button.tsx", "components/copy-button.tsx"],
];

/**
 * The CLI ships vendored copies of each template; every one must carry the
 * identical PEPU design system so scaffolded apps all look like one family.
 * (Run `pnpm sync` after editing templates/_design + templates/scripts/sync-design.mjs.)
 */
describe("vendored design system", () => {
  for (const template of TEMPLATES) {
    it(`${template} carries the canonical shared design files`, async () => {
      for (const [source, destination] of SHARED) {
        const vendored = path.join(packageRoot, "templates", template, destination);
        expect(existsSync(vendored), `${template}/${destination} missing`).toBe(true);
        const [expected, actual] = await Promise.all([
          readFile(path.join(canonicalDir, source), "utf8"),
          readFile(vendored, "utf8"),
        ]);
        expect(actual, `${template}/${destination} drifted from _design/${source}`).toBe(expected);
      }
    });

    it(`${template} imports the design system from globals.css`, async () => {
      const css = await readFile(
        path.join(packageRoot, "templates", template, "app", "globals.css"),
        "utf8",
      );
      expect(css).toContain('@import "./pepu-design.css"');
    });
  }
});
