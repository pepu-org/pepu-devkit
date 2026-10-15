/**
 * Config behaviour added for hosting: Docker-secret style *_FILE loading (env fallback for the signer key),
 * configurable signer address, and the dev/prod apps registry split.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_PAYMASTER_SIGNER_ADDRESS,
  LOCAL_DEV_APP_KEY_HASH_HEX,
  isProduction,
  loadAppRegistryConfig,
  loadSecretFiles,
  resolveAppsConfigPath,
  resolveExpectedSignerAddress,
} from "../src/config.js";

const here = dirname(fileURLToPath(import.meta.url));
const configDir = resolve(here, "..", "config");
const FAKE_SECRET = "fake-secret-value-for-tests-only";

describe("loadSecretFiles", () => {
  const dir = mkdtempSync(join(tmpdir(), "pepu-secrets-"));
  const file = (name: string, contents: string) => {
    const p = join(dir, name);
    writeFileSync(p, contents);
    return p;
  };

  it("reads <NAME>_FILE into <NAME>, trimming the trailing newline", () => {
    const env: NodeJS.ProcessEnv = { PRIVY_APP_SECRET_FILE: file("privy", `${FAKE_SECRET}\n`) };
    loadSecretFiles(env);
    expect(env.PRIVY_APP_SECRET).toBe(FAKE_SECRET);
  });

  it("a directly set variable wins over the file", () => {
    const env: NodeJS.ProcessEnv = { ADMIN_TOKEN: "direct", ADMIN_TOKEN_FILE: file("admin", "from-file") };
    loadSecretFiles(env);
    expect(env.ADMIN_TOKEN).toBe("direct");
  });

  it("supports the signer key and the RPC URL", () => {
    const env: NodeJS.ProcessEnv = {
      PAYMASTER_SIGNER_PRIVATE_KEY_FILE: file("signer", "0xabc"),
      RPC_URL_FILE: file("rpc", "https://rpc.example/key"),
    };
    loadSecretFiles(env);
    expect(env.PAYMASTER_SIGNER_PRIVATE_KEY).toBe("0xabc");
    expect(env.RPC_URL).toBe("https://rpc.example/key");
  });

  it("fails fast on an unreadable file and never echoes contents", () => {
    const env: NodeJS.ProcessEnv = { ADMIN_TOKEN_FILE: join(dir, "does-not-exist") };
    expect(() => loadSecretFiles(env)).toThrow(/ADMIN_TOKEN_FILE.*could not be read/);
  });

  it("fails fast on an empty file", () => {
    const env: NodeJS.ProcessEnv = { ADMIN_TOKEN_FILE: file("empty", "  \n") };
    expect(() => loadSecretFiles(env)).toThrow(/is empty/);
  });

  it("does nothing when no *_FILE variable is set", () => {
    const env: NodeJS.ProcessEnv = {};
    loadSecretFiles(env);
    expect(env).toEqual({});
  });
});

describe("resolveExpectedSignerAddress", () => {
  const FRESH = "0x1111111111111111111111111111111111111111";

  it("uses PAYMASTER_SIGNER_ADDRESS when set (hosted fresh key)", () => {
    expect(resolveExpectedSignerAddress({ PAYMASTER_SIGNER_ADDRESS: FRESH })).toBe(FRESH);
  });

  it("falls back to the legacy dev address outside production", () => {
    expect(resolveExpectedSignerAddress({})).toBe(EXPECTED_PAYMASTER_SIGNER_ADDRESS);
  });

  it("is REQUIRED in production so the dev address can never be accepted by accident", () => {
    expect(() => resolveExpectedSignerAddress({ NODE_ENV: "production" })).toThrow(/PAYMASTER_SIGNER_ADDRESS is required/);
    expect(resolveExpectedSignerAddress({ NODE_ENV: "production", PAYMASTER_SIGNER_ADDRESS: FRESH })).toBe(FRESH);
  });

  it("rejects a malformed address", () => {
    expect(() => resolveExpectedSignerAddress({ PAYMASTER_SIGNER_ADDRESS: "0x123" })).toThrow(/not a 0x-prefixed/);
  });
});

describe("apps registry: production vs dev split", () => {
  it("production file (config/apps.json) does not contain the local-dev key hash", () => {
    const raw = readFileSync(join(configDir, "apps.json"), "utf8");
    expect(raw).not.toContain(LOCAL_DEV_APP_KEY_HASH_HEX);
    const { apps } = loadAppRegistryConfig(join(configDir, "apps.json"), { NODE_ENV: "production" });
    expect(apps.some((a) => a.id === "sponsored-session-app")).toBe(false);
    expect(apps.length).toBeGreaterThan(0);
  });

  it("dev file keeps the local-dev entry so local testing still works", () => {
    const { apps } = loadAppRegistryConfig(join(configDir, "apps.dev.json"), {});
    expect(apps.find((a) => a.id === "sponsored-session-app")?.apiKeyHashHex).toBe(LOCAL_DEV_APP_KEY_HASH_HEX);
  });

  it("dev file is a superset of the production file (shared apps are identical)", () => {
    const prod = loadAppRegistryConfig(join(configDir, "apps.json"), {}).apps;
    const dev = loadAppRegistryConfig(join(configDir, "apps.dev.json"), {}).apps;
    for (const app of prod) expect(dev).toContainEqual(app);
  });

  it("refuses to load a registry containing the dev hash when NODE_ENV=production", () => {
    expect(() => loadAppRegistryConfig(join(configDir, "apps.dev.json"), { NODE_ENV: "production" })).toThrow(
      /local-dev API key hash/,
    );
  });

  it("selects the file by env: default is production-safe, PEPU_APPS_PROFILE=dev picks apps.dev.json", () => {
    expect(resolveAppsConfigPath({})).toBe(join(configDir, "apps.json"));
    expect(resolveAppsConfigPath({ PEPU_APPS_PROFILE: "prod" })).toBe(join(configDir, "apps.json"));
    expect(resolveAppsConfigPath({ PEPU_APPS_PROFILE: "dev" })).toBe(join(configDir, "apps.dev.json"));
    expect(resolveAppsConfigPath({ APPS_CONFIG_PATH: "/etc/pepu/apps.json", PEPU_APPS_PROFILE: "dev" })).toBe(
      "/etc/pepu/apps.json",
    );
  });

  it("PEPU_APPS_PROFILE=dev is refused in production, and unknown profiles are rejected", () => {
    expect(() => resolveAppsConfigPath({ NODE_ENV: "production", PEPU_APPS_PROFILE: "dev" })).toThrow(/not allowed/);
    expect(() => resolveAppsConfigPath({ PEPU_APPS_PROFILE: "staging" })).toThrow(/not valid/);
  });

  it("isProduction is case-insensitive", () => {
    expect(isProduction({ NODE_ENV: "Production" })).toBe(true);
    expect(isProduction({ NODE_ENV: "development" })).toBe(false);
    expect(isProduction({})).toBe(false);
  });
});
