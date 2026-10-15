import { describe, expect, it } from "vitest";
import { createTestClient } from "./test-helpers.js";

/** Each new tool description must name the SDK function it uses. */
const SDK_FUNCTION: Record<string, string> = {
  pepu_bundler_health: "probeBundler",
  pepu_paymaster_health: "probePaymaster",
  pepu_sponsorship_status: "checkSponsorship",
  pepu_project_balance: "readProject",
  pepu_explain_error: "explainError",
  pepu_explain_tx: "userOpEventFromReceipt",
  pepu_list_templates: "TEMPLATE_REQUIREMENTS",
  pepu_scaffold_app: "checkPepuEnv",
  pepu_check_env: "checkPepuEnv",
  pepu_check_privy_config: "checkPrivyDashboardConfig",
  pepu_generate_authorization_key: "generatePrivyAuthorizationKey",
  pepu_session_policy: "buildSessionPolicy",
  pepu_encode_calls: "encodeAggregate3",
  pepu_prepare_project_tx: "configureProject",
  pepu_get_docs: "docs",
  pepu_sdk_snippet: "@pepu-chain/sdk",
  pepu_sdk_exports: "@pepu-chain/sdk",
};

describe("tool surface", () => {
  it("lists 32 uniquely named tools, each with all four annotations", async () => {
    const client = await createTestClient();
    const { tools } = await client.listTools();
    expect(tools.length).toBe(32);
    expect(new Set(tools.map((t) => t.name)).size).toBe(32);
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint, t.name).toBeTypeOf("boolean");
      expect(t.annotations?.destructiveHint, t.name).toBeTypeOf("boolean");
      expect(t.annotations?.idempotentHint, t.name).toBeTypeOf("boolean");
      expect(t.annotations?.openWorldHint, t.name).toBeTypeOf("boolean");
    }
  });

  it("every new tool description names its SDK function", async () => {
    const client = await createTestClient();
    const { tools } = await client.listTools();
    for (const [name, fn] of Object.entries(SDK_FUNCTION)) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      expect(tool?.description, name).toContain(fn);
    }
  });

  it("only the two write tools are not read-only, and neither is destructive", async () => {
    const client = await createTestClient();
    const { tools } = await client.listTools();
    const writers = tools.filter((t) => t.annotations?.readOnlyHint === false);
    expect(writers.map((t) => t.name).sort()).toEqual(["pepu_generate_authorization_key", "pepu_scaffold_app"]);
    for (const t of writers) expect(t.annotations?.destructiveHint).toBe(false);
  });

  it("serves resources and prompts", async () => {
    const client = await createTestClient();
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain("pepu://chain-facts");
    expect(uris).toContain("pepu://addresses");
    expect(uris).toContain("pepu://sdk/exports");
    expect(uris.some((u) => u.startsWith("pepu://docs/"))).toBe(true);
    expect(JSON.stringify(await client.readResource({ uri: "pepu://chain-facts" }))).toContain("97741");
    expect(JSON.stringify(await client.readResource({ uri: "pepu://addresses" }))).toContain("paymasterV2");
    expect(JSON.stringify(await client.readResource({ uri: "pepu://docs/onboarding/session-keys" })).length).toBeGreaterThan(500);
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(["add-google-login", "add-session", "add-sponsored-session", "add-sponsorship", "debug-tx", "new-pepu-app"]);
    const p = await client.getPrompt({ name: "debug-tx", arguments: { hash: "0x" + "ab".repeat(32) } });
    expect(JSON.stringify(p)).toContain("pepu_explain_tx");
  });
});
