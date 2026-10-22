import { afterEach, describe, expect, it } from "vitest";
import {
  detectPackageManager,
  installCommand,
  isPackageManagerName,
  runScriptCommand,
} from "../src/package-manager.js";

describe("isPackageManagerName", () => {
  it("accepts the four supported managers", () => {
    expect(isPackageManagerName("npm")).toBe(true);
    expect(isPackageManagerName("pnpm")).toBe(true);
    expect(isPackageManagerName("yarn")).toBe(true);
    expect(isPackageManagerName("bun")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isPackageManagerName("cargo")).toBe(false);
    expect(isPackageManagerName("")).toBe(false);
  });
});

describe("detectPackageManager", () => {
  const originalUserAgent = process.env.npm_config_user_agent;

  afterEach(() => {
    if (originalUserAgent === undefined) delete process.env.npm_config_user_agent;
    else process.env.npm_config_user_agent = originalUserAgent;
  });

  it("defaults to npm when the env var is unset", () => {
    delete process.env.npm_config_user_agent;
    expect(detectPackageManager()).toBe("npm");
  });

  it("recognizes pnpm, yarn, and bun user agents", () => {
    process.env.npm_config_user_agent = "pnpm/9.0.0 npm/? node/v20.0.0";
    expect(detectPackageManager()).toBe("pnpm");

    process.env.npm_config_user_agent = "yarn/4.0.0 npm/? node/v20.0.0";
    expect(detectPackageManager()).toBe("yarn");

    process.env.npm_config_user_agent = "bun/1.1.0 npm/? node/v20.0.0";
    expect(detectPackageManager()).toBe("bun");
  });

  it("falls back to npm for an npm or unrecognized user agent", () => {
    process.env.npm_config_user_agent = "npm/10.0.0 node/v20.0.0";
    expect(detectPackageManager()).toBe("npm");
  });
});

describe("installCommand / runScriptCommand", () => {
  it("uses the right verbs per package manager", () => {
    expect(installCommand("npm")).toBe("npm install");
    expect(installCommand("pnpm")).toBe("pnpm install");
    expect(installCommand("yarn")).toBe("yarn");
    expect(installCommand("bun")).toBe("bun install");

    expect(runScriptCommand("npm", "dev")).toBe("npm run dev");
    expect(runScriptCommand("pnpm", "dev")).toBe("pnpm dev");
    expect(runScriptCommand("yarn", "dev")).toBe("yarn dev");
    expect(runScriptCommand("bun", "dev")).toBe("bun run dev");
  });
});
