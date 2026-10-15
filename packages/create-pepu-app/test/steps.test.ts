import { describe, expect, it } from "vitest";
import { buildGuidance, expandStep } from "../src/steps.js";
import { findTemplate, TEMPLATES } from "../src/templates.js";

function guidance(name: string, env: Record<string, string> = {}, installed = false) {
  const template = findTemplate(name);
  if (!template) throw new Error(name);
  return buildGuidance({ template, env, packageManager: "pnpm", relativeDir: "my-app", installed, hasDoctor: false });
}

describe("buildGuidance", () => {
  it("lists the template's required env from the SDK doctor, flagging secrets", () => {
    const g = guidance("game-app");
    expect(g.requiredEnv.map((e) => e.key)).toContain("PRIVY_AUTHORIZATION_KEY");
    expect(g.requiredEnv.find((e) => e.key === "PRIVY_APP_SECRET")?.secret).toBe(true);
    expect(g.requiredEnv.find((e) => e.key === "NEXT_PUBLIC_PRIVY_APP_ID")?.secret).toBe(false);
  });

  it("drops env that is already set and skips install when already installed", () => {
    const g = guidance("consumer-app", { NEXT_PUBLIC_PRIVY_APP_ID: "abc" }, true);
    expect(g.missingEnv).toEqual(["PRIVY_APP_SECRET"]);
    expect(g.nextSteps.join("\n")).not.toMatch(/pnpm install/);
    expect(g.nextSteps[0]).toBe("cd my-app");
    expect(g.nextSteps.at(-1)).toBe("pnpm dev");
  });

  it("includes Privy dashboard labels and template-specific steps", () => {
    const sponsored = guidance("sponsored-session-app").nextSteps.join("\n");
    expect(sponsored).toMatch(/Google login is enabled/);
    expect(sponsored).toMatch(/PEPU_BUNDLER_URL/);
    expect(sponsored).toMatch(/bundler\.pepeunchained\.com/);
    expect(sponsored).not.toMatch(/ngrok/i);
    expect(guidance("game-app").nextSteps.join("\n")).toMatch(/pnpm generate-authorization-key/);
    expect(guidance("sponsored-demo").privyDashboard.map((d) => d.id)).toContain("smart-wallets");
  });

  it("reports an unsatisfied requiredAnyOf group (token-gated, no gate token set)", () => {
    const g = guidance("token-gated-app");
    expect(g.missingAnyOf).toEqual([["NEXT_PUBLIC_GATE_ERC20_ADDRESS", "NEXT_PUBLIC_GATE_ERC721_ADDRESS"]]);
    expect(guidance("token-gated-app", { NEXT_PUBLIC_GATE_ERC20_ADDRESS: "0x1" }).missingAnyOf).toEqual([]);
  });

  it("produces guidance for every template", () => {
    for (const t of TEMPLATES) expect(guidance(t.name).nextSteps.length).toBeGreaterThan(2);
  });

  it("expands {run:script} per package manager", () => {
    expect(expandStep("Run {run:foo}.", "npm")).toBe("Run npm run foo.");
    expect(expandStep("Run {run:foo}.", "yarn")).toBe("Run yarn foo.");
  });
});
