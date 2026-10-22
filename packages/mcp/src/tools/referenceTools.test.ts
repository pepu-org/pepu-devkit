import { describe, expect, it } from "vitest";
import { TEMPLATE_REQUIREMENTS } from "@pepu-chain/sdk/doctor";
import { createTestClient, isError, jsonOf } from "../test-helpers.js";
import { TEMPLATE_REGISTRY } from "../snapshots.js";
import { WHEN_TO_PICK } from "./listTemplates.js";

describe("pepu_list_templates", () => {
  it("lists every registry template with SDK requirements and guidance", async () => {
    const client = await createTestClient();
    const out = jsonOf(await client.callTool({ name: "pepu_list_templates", arguments: {} })) as { templates: { name: string; pillars: string[]; requiredEnv: string[]; whenToPick: string; needsBundlerAndPaymaster: boolean }[] };
    expect(out.templates.map((t) => t.name)).toEqual(TEMPLATE_REGISTRY.map((t) => t.name));
    for (const t of out.templates) {
      expect(t.pillars, t.name).toEqual(TEMPLATE_REQUIREMENTS[t.name]?.pillars);
      expect(t.whenToPick, t.name).toBeTruthy();
      expect(WHEN_TO_PICK[t.name], t.name).toBeDefined();
    }
    expect(out.templates.find((t) => t.name === "sponsored-session-app")?.needsBundlerAndPaymaster).toBe(true);
  });
});

describe("pepu_get_docs", () => {
  it("lists pages, serves one by slug and finds sections by query", async () => {
    const client = await createTestClient();
    const list = jsonOf(await client.callTool({ name: "pepu_get_docs", arguments: {} })) as { pages: { slug: string }[] };
    expect(list.pages.length).toBeGreaterThan(20);
    const page = jsonOf(await client.callTool({ name: "pepu_get_docs", arguments: { slug: "onboarding/session-keys" } })) as { content: string; url: string };
    expect(page.url).toBe("https://docs.pepeunchained.com/onboarding/session-keys");
    expect(page.content.length).toBeGreaterThan(500);
    const hit = jsonOf(await client.callTool({ name: "pepu_get_docs", arguments: { query: "multicall3 canonical address" } })) as { best: { slug: string; content: string } };
    expect(hit.best.slug).toMatch(/multicall/);
  });

  it("gives an actionable error for an unknown slug", async () => {
    const client = await createTestClient();
    expect(isError(await client.callTool({ name: "pepu_get_docs", arguments: { slug: "does/not-exist" } }))).toBe(true);
  });
});

describe("pepu_sdk_snippet and pepu_sdk_exports", () => {
  it("returns a snippet with imports, env and caveats, and lists them all without a task", async () => {
    const client = await createTestClient();
    const one = jsonOf(await client.callTool({ name: "pepu_sdk_snippet", arguments: { task: "sponsored-session" } })) as { code: string; env: string[]; notes: string[]; imports: { subpath: string }[] };
    expect(one.code).toContain("createSponsoredSessionRoutes");
    expect(one.env).toContain("PEPU_BUNDLER_URL");
    expect(one.imports[0]?.subpath).toBe("@pepu-chain/sdk/combo");
    const all = jsonOf(await client.callTool({ name: "pepu_sdk_snippet", arguments: {} })) as { snippets: unknown[] };
    expect(all.snippets.length).toBeGreaterThan(10);
  });

  it("lists SDK subpaths and exports, filtered", async () => {
    const client = await createTestClient();
    const paths = jsonOf(await client.callTool({ name: "pepu_sdk_exports", arguments: {} })) as { subpaths: { path: string }[] };
    expect(paths.subpaths.map((p) => p.path)).toEqual(expect.arrayContaining(["@pepu-chain/sdk", "@pepu-chain/sdk/session/kernel", "@pepu-chain/sdk/combo"]));
    const found = jsonOf(await client.callTool({ name: "pepu_sdk_exports", arguments: { subpath: "session", search: "buildSessionPolicy" } })) as { exports: { name: string; kind: string }[] };
    expect(found.exports[0]).toMatchObject({ name: "buildSessionPolicy", kind: "function" });
    expect(isError(await client.callTool({ name: "pepu_sdk_exports", arguments: { subpath: "nope" } }))).toBe(true);
  });
});
