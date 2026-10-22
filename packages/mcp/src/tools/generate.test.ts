import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestClient, isError, jsonOf, textOf } from "../test-helpers.js";
import { setCommandRunner } from "./scaffoldApp.js";

const CANARY = "CANARY-SECRET-do-not-leak-0123456789";
const CONTRACT = "0x261eA5971B93237a56990206A46Bc80318e4d078";
let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pepu-mcp-"));
});
afterEach(() => {
  setCommandRunner(null);
  vi.unstubAllGlobals();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("pepu_check_env", () => {
  it("never returns a value: canary secrets in files and pasted text stay out of every output", async () => {
    fs.writeFileSync(path.join(tmp, ".env.local"), `NEXT_PUBLIC_PRIVY_APP_ID=cabcdefghijklmnopqrstuvwx\nPRIVY_APP_SECRET=${CANARY}\nPRIVY_AUTHORIZATION_KEY=${CANARY}-key\n`);
    const client = await createTestClient();
    const res = await client.callTool({ name: "pepu_check_env", arguments: { projectDir: tmp, template: "game-app", envText: `PEPU_BUNDLER_URL=https://${CANARY}-bundler.example` } });
    const text = textOf(res);
    expect(text).not.toContain("CANARY");
    const out = jsonOf(res) as { items: { key: string; status: string; secret: boolean; length: number }[]; ok: boolean };
    const secret = out.items.find((i) => i.key === "PRIVY_APP_SECRET");
    expect(secret).toMatchObject({ status: "ok", secret: true, length: CANARY.length });
    expect(out.ok).toBe(false);
    expect(out.items.find((i) => i.key === "NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID")?.status).toBe("missing");
  });

  it("does not leak a canary through the error path either, and refuses relative paths", async () => {
    const client = await createTestClient();
    const rel = await client.callTool({ name: "pepu_check_env", arguments: { projectDir: "relative/dir" } });
    expect(isError(rel)).toBe(true);
    const trav = await client.callTool({ name: "pepu_check_env", arguments: { projectDir: `${tmp}${path.sep}..${path.sep}x` } });
    expect(isError(trav)).toBe(true);
    const unknown = await client.callTool({ name: "pepu_check_env", arguments: { envText: `A=${CANARY}`, template: "nope" } });
    expect(isError(unknown)).toBe(true);
    expect(textOf(unknown)).not.toContain("CANARY");
  });
});

describe("pepu_generate_authorization_key", () => {
  it("writes nothing and generates nothing without confirm_write", async () => {
    const file = path.join(tmp, ".env.local");
    const client = await createTestClient();
    const out = jsonOf(await client.callTool({ name: "pepu_generate_authorization_key", arguments: { envFile: file } })) as { written: boolean };
    expect(out.written).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("writes the private half to the file and returns only the public key", async () => {
    const file = path.join(tmp, ".env.local");
    fs.writeFileSync(file, "FOO=bar\n");
    const client = await createTestClient();
    const res = await client.callTool({ name: "pepu_generate_authorization_key", arguments: { envFile: file, confirm_write: true } });
    const out = jsonOf(res) as { written: boolean; publicKey: string; privateKeyReturned: boolean };
    const content = fs.readFileSync(file, "utf8");
    const privateKey = /PRIVY_AUTHORIZATION_KEY=(\S+)/.exec(content)?.[1];
    expect(out.written).toBe(true);
    expect(out.privateKeyReturned).toBe(false);
    expect(privateKey && privateKey.length > 100).toBe(true);
    expect(content).toContain("FOO=bar");
    expect(textOf(res)).not.toContain(privateKey as string);
    expect(out.publicKey.length).toBeGreaterThan(50);
  });

  it("refuses to replace an existing key without overwrite, and refuses non-env or relative paths", async () => {
    const file = path.join(tmp, ".env.local");
    fs.writeFileSync(file, "PRIVY_AUTHORIZATION_KEY=existing-value\n");
    const client = await createTestClient();
    expect(isError(await client.callTool({ name: "pepu_generate_authorization_key", arguments: { envFile: file, confirm_write: true } }))).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toContain("existing-value");
    expect(isError(await client.callTool({ name: "pepu_generate_authorization_key", arguments: { envFile: path.join(tmp, "notes.txt"), confirm_write: true } }))).toBe(true);
    expect(isError(await client.callTool({ name: "pepu_generate_authorization_key", arguments: { envFile: ".env.local", confirm_write: true } }))).toBe(true);
  });
});

describe("pepu_scaffold_app", () => {
  it("dry run validates and shows the command without creating anything", async () => {
    const dir = path.join(tmp, "my-app");
    const client = await createTestClient();
    const out = jsonOf(await client.callTool({ name: "pepu_scaffold_app", arguments: { template: "consumer-app", directory: dir, dry_run: true } })) as { dryRun: boolean; command: string };
    expect(out.dryRun).toBe(true);
    expect(out.command).toContain("--yes --json");
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("refuses a non-empty directory, a relative path, traversal and an unknown template", async () => {
    fs.writeFileSync(path.join(tmp, "keep.txt"), "x");
    const client = await createTestClient();
    for (const directory of [tmp, "my-app", `${tmp}${path.sep}a${path.sep}..${path.sep}b`]) {
      expect(isError(await client.callTool({ name: "pepu_scaffold_app", arguments: { template: "consumer-app", directory, dry_run: true } })), directory).toBe(true);
    }
    expect(isError(await client.callTool({ name: "pepu_scaffold_app", arguments: { template: "nope", directory: path.join(tmp, "z"), dry_run: true } }))).toBe(true);
    expect(fs.readFileSync(path.join(tmp, "keep.txt"), "utf8")).toBe("x");
  });

  it("runs the CLI, writes the optional env to .env.local without echoing it, and reports what is still missing", async () => {
    const dir = path.join(tmp, "app");
    const seen: string[][] = [];
    setCommandRunner(async (_cmd, args) => {
      seen.push(args);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "package.json"), "{}");
      fs.writeFileSync(path.join(dir, ".env.local"), "NEXT_PUBLIC_PRIVY_APP_ID=\nPRIVY_APP_SECRET=\n");
      return { code: 0, stdout: '{"ok":true}\n', stderr: "" };
    });
    const client = await createTestClient();
    const res = await client.callTool({
      name: "pepu_scaffold_app",
      arguments: { template: "sponsored-session-app", directory: dir, packageManager: "pnpm", privyAppId: "cabcdefghijklmnopqrstuvwx", paymasterUrl: `https://pm.example.com/paymaster/${CANARY}` },
    });
    const out = jsonOf(res) as { created: string; envWritten: string[]; envStillMissing: { key: string }[] };
    expect(seen[0]).toEqual(expect.arrayContaining(["--template", "sponsored-session-app", "--yes", "--json", "--pm", "pnpm"]));
    expect(out.envWritten).toEqual(["NEXT_PUBLIC_PRIVY_APP_ID", "PEPU_PAYMASTER_URL"]);
    expect(out.envStillMissing.map((m) => m.key)).toEqual(expect.arrayContaining(["PRIVY_APP_SECRET", "PEPU_BUNDLER_URL"]));
    expect(textOf(res)).not.toContain("CANARY");
    expect(fs.readFileSync(path.join(dir, ".env.local"), "utf8")).toContain(CANARY);
  });

  it("retries without --json for an older CLI", async () => {
    const dir = path.join(tmp, "old");
    const calls: string[][] = [];
    setCommandRunner(async (_cmd, args) => {
      calls.push(args);
      if (args.includes("--json")) return { code: 1, stdout: "", stderr: 'Unrecognized option "--json".' };
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "package.json"), "{}");
      return { code: 0, stdout: "done", stderr: "" };
    });
    const client = await createTestClient();
    const res = await client.callTool({ name: "pepu_scaffold_app", arguments: { template: "consumer-app", directory: dir } });
    expect(isError(res)).toBe(false);
    expect(calls).toHaveLength(2);
  });
});

describe("pepu_check_privy_config", () => {
  it("maps Privy's public config to pass, fail and unknown rows with fixes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } })));
    const client = await createTestClient();
    const out = jsonOf(await client.callTool({ name: "pepu_check_privy_config", arguments: { appId: "cabcdefghijklmnopqrstuvwx", origin: "http://localhost:3000" } })) as { dashboard: { id: string; result: string }[]; notRemotelyCheckable: unknown[] };
    expect(out.dashboard.length).toBeGreaterThan(0);
    expect(out.dashboard.every((d) => ["pass", "fail", "unknown"].includes(d.result))).toBe(true);
    expect(out.notRemotelyCheckable.length).toBeGreaterThan(0);
  });

  it("reports unknown, not failure, when Privy cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const client = await createTestClient();
    const out = jsonOf(await client.callTool({ name: "pepu_check_privy_config", arguments: { appId: "cabcdefghijklmnopqrstuvwx" } })) as { ok: boolean; dashboard: { result: string }[] };
    expect(out.ok).toBe(true);
    expect(out.dashboard.every((d) => d.result === "unknown")).toBe(true);
  });
});

describe("pepu_session_policy", () => {
  it("builds a privy policy with consent text, selectors and the trust notice", async () => {
    const client = await createTestClient();
    const out = jsonOf(await client.callTool({ name: "pepu_session_policy", arguments: { mode: "privy", contract: CONTRACT, functions: ["tap()"], minutes: 10 } })) as { policy: { rules: { method: string }[] }; selectors: { signature: string; selector: string }[]; trustNotice: string; snippet: string };
    expect(out.policy.rules[0]?.method).toBe("eth_signTransaction");
    expect(out.selectors[0]?.signature).toBe("tap()");
    expect(out.selectors[0]?.selector).toMatch(/^0x[0-9a-f]{8}$/);
    expect(out.trustNotice).toMatch(/Privy/);
    expect(out.snippet).toContain("createSessionRoutes");
  });

  it("builds a kernel scope with on-chain trust notice and a value limit", async () => {
    const client = await createTestClient();
    const out = jsonOf(await client.callTool({ name: "pepu_session_policy", arguments: { mode: "kernel", contract: CONTRACT, functions: ["tap()"], valueLimitWei: "5" } })) as { scope: { calls: { maxValueWei: string }[] }; trustNotice: string };
    expect(out.scope.calls[0]?.maxValueWei).toBe("5");
    expect(out.trustNotice).toMatch(/on-chain/);
  }, 60_000);

  it("rejects a value limit in privy mode, a bad address and an unparseable signature", async () => {
    const client = await createTestClient();
    expect(isError(await client.callTool({ name: "pepu_session_policy", arguments: { mode: "privy", contract: CONTRACT, functions: ["tap()"], valueLimitWei: "1" } }))).toBe(true);
    expect(isError(await client.callTool({ name: "pepu_session_policy", arguments: { mode: "privy", contract: "0x12", functions: ["tap()"] } }))).toBe(true);
    expect(isError(await client.callTool({ name: "pepu_session_policy", arguments: { mode: "privy", contract: CONTRACT, functions: ["not a signature"] } }))).toBe(true);
  });
});

describe("pepu_encode_calls", () => {
  const token = "0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd";
  const call = { to: token, signature: "transfer(address to, uint256 amount)", args: [CONTRACT, "1000000000000000000"] };

  it("encodes calldata with string integers coerced", async () => {
    const client = await createTestClient();
    const out = jsonOf(await client.callTool({ name: "pepu_encode_calls", arguments: { calls: [call] } })) as { calls: { selector: string; calldata: string }[] };
    expect(out.calls[0]?.selector).toBe("0xa9059cbb");
    expect(out.calls[0]?.calldata.length).toBe(2 + 8 + 128);
  });

  it("wraps in aggregate3 targeting PEPU's Multicall3, never the canonical address", async () => {
    const client = await createTestClient();
    const out = jsonOf(await client.callTool({ name: "pepu_encode_calls", arguments: { calls: [call, call], as: "multicall3" } })) as { to: string; data: string };
    expect(out.to).toBe("0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd");
    expect(out.data.startsWith("0x82ad56cb")).toBe(true);
  });

  it("builds ERC-7579 kernel execute calldata, single and batch", async () => {
    const client = await createTestClient();
    const one = jsonOf(await client.callTool({ name: "pepu_encode_calls", arguments: { calls: [call], as: "kernel-execute" } })) as { callData: string; mode: string };
    const many = jsonOf(await client.callTool({ name: "pepu_encode_calls", arguments: { calls: [call, call], as: "userop-callData" } })) as { callData: string; mode: string };
    expect(one.callData.startsWith("0xe9ae5c53")).toBe(true);
    expect(one.mode).toMatch(/single/);
    expect(many.mode).toMatch(/batch/);
  });

  it("refuses value inside multicall3 and bad arguments", async () => {
    const client = await createTestClient();
    expect(isError(await client.callTool({ name: "pepu_encode_calls", arguments: { calls: [{ ...call, value: "1" }], as: "multicall3" } }))).toBe(true);
    expect(isError(await client.callTool({ name: "pepu_encode_calls", arguments: { calls: [{ ...call, args: [CONTRACT] }] } }))).toBe(true);
  });
});

describe("pepu_prepare_project_tx", () => {
  const pm = "0x3333333333333333333333333333333333333333";

  it("defaults to the registry's deployed v2 paymaster when no paymaster address is given", async () => {
    const client = await createTestClient();
    const out = jsonOf(await client.callTool({ name: "pepu_prepare_project_tx", arguments: { action: "deposit", appId: "app", amountPepu: "1" } })) as { prepared: boolean; transactions: { to: string }[] };
    expect(out.prepared).toBe(true);
    expect(out.transactions[0]?.to).toBe("0xdb28528C9399C33c9A0297E8A62F39145acbC30D");
  });

  it("encodes a deposit with the one-way warning and the case-sensitivity warning", async () => {
    const client = await createTestClient();
    const out = jsonOf(await client.callTool({ name: "pepu_prepare_project_tx", arguments: { action: "deposit", paymaster: pm, appId: "App", amountPepu: "2.5" } })) as { transactions: { to: string; value: string; data: string }[]; warnings: string[] };
    expect(out.transactions[0]?.to).toBe(pm);
    expect(out.transactions[0]?.value).toBe("2500000000000000000");
    expect(out.warnings.join(" ")).toMatch(/ONE-WAY/);
    expect(out.warnings.join(" ")).toMatch(/case-sensitive/);
  });

  it("encodes the three configure calls in order", async () => {
    const client = await createTestClient();
    const out = jsonOf(await client.callTool({ name: "pepu_prepare_project_tx", arguments: { action: "configure", paymaster: pm, appId: "App", targets: [CONTRACT], dailyLimitPepu: "50", senderDailyLimitPepu: "5" } })) as { transactions: { function: string }[] };
    expect(out.transactions.map((t) => t.function.split("(")[0])).toEqual(["setTargets", "setDailyLimit", "setSenderDailyLimit"]);
  });

  it("requires an attestation for claim", async () => {
    const client = await createTestClient();
    expect(isError(await client.callTool({ name: "pepu_prepare_project_tx", arguments: { action: "claim", paymaster: pm } }))).toBe(true);
  });
});
