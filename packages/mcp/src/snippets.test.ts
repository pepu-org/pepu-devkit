import { describe, expect, it } from "vitest";
import { SNIPPETS, parseSnippetImports } from "./snippets.js";
import { SDK_EXPORTS } from "./snapshots.js";

describe("snippets", () => {
  it("every import resolves to a real SDK subpath and export", () => {
    for (const s of SNIPPETS) {
      const imports = parseSnippetImports(s.code);
      expect(imports.length, s.id).toBeGreaterThan(0);
      for (const imp of imports) {
        const exports = SDK_EXPORTS.subpaths[imp.subpath];
        expect(exports, `${s.id}: ${imp.subpath}`).toBeDefined();
        for (const name of imp.names) {
          expect(exports?.some((e) => e.name === name), `${s.id}: ${name} from ${imp.subpath}`).toBe(true);
        }
      }
    }
  });

  it("covers every pillar and the sponsored-session combination, with unique ids", () => {
    const ids = SNIPPETS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["privy-provider", "ensure-wallet-route", "grant-session", "session-routes", "kernel-session-policy", "sponsored-send", "sponsored-session", "sponsored-session-client", "multicall-read", "v2-deposit"]) {
      expect(ids).toContain(id);
    }
  });

  it("sponsorship and v2 snippets carry the honest caveats and no ngrok URLs", () => {
    expect(JSON.stringify(SNIPPETS)).not.toMatch(/ngrok/i);
    expect(SNIPPETS.find((s) => s.id === "sponsored-send")?.notes.join(" ")).toMatch(/bundler\.pepeunchained\.com/);
    expect(SNIPPETS.find((s) => s.id === "v2-deposit")?.notes.join(" ")).toMatch(/audit pending/);
  });
});
