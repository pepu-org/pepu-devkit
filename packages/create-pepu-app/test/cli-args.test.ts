import { describe, expect, it } from "vitest";
import { CliArgsError, parseArgs } from "../src/cli-args.js";
import { DEFAULT_TEMPLATE } from "../src/templates.js";

describe("parseArgs", () => {
  it("defaults to the default template and no directory when given nothing", () => {
    const args = parseArgs([]);
    expect(args).toEqual({
      template: DEFAULT_TEMPLATE,
      templateExplicit: false,
      yes: false,
      sdk: "npm",
      json: false,
      list: false,
      skipAgentFiles: false,
      help: false,
      version: false,
      directory: undefined,
      packageManager: undefined,
    });
  });

  it("captures a bare positional as the directory", () => {
    const args = parseArgs(["my-app"]);
    expect(args.directory).toBe("my-app");
  });

  it("parses --yes / -y", () => {
    expect(parseArgs(["--yes"]).yes).toBe(true);
    expect(parseArgs(["-y"]).yes).toBe(true);
    expect(parseArgs([]).yes).toBe(false);
  });

  it("parses --template with a value", () => {
    expect(parseArgs(["--template", "consumer-app"]).template).toBe("consumer-app");
    expect(parseArgs(["-t", "consumer-app"]).template).toBe("consumer-app");
  });

  it("marks templateExplicit only when --template/-t was actually passed", () => {
    expect(parseArgs([]).templateExplicit).toBe(false);
    expect(parseArgs(["--template", "nft-mint"]).templateExplicit).toBe(true);
    expect(parseArgs(["-t", "nft-mint"]).templateExplicit).toBe(true);
  });

  it("throws when --template is missing its value", () => {
    expect(() => parseArgs(["--template"])).toThrow(CliArgsError);
  });

  it("parses a valid --pm value", () => {
    expect(parseArgs(["--pm", "pnpm"]).packageManager).toBe("pnpm");
  });

  it("rejects an invalid --pm value", () => {
    expect(() => parseArgs(["--pm", "cargo"])).toThrow(CliArgsError);
  });

  it("rejects an unrecognized flag", () => {
    expect(() => parseArgs(["--nope"])).toThrow(CliArgsError);
  });

  it("rejects a second positional argument", () => {
    expect(() => parseArgs(["my-app", "other"])).toThrow(CliArgsError);
  });

  it("parses --help and --version", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
    expect(parseArgs(["--version"]).version).toBe(true);
    expect(parseArgs(["-v"]).version).toBe(true);
  });

  it("parses a full combination", () => {
    const args = parseArgs(["my-app", "--template", "consumer-app", "--pm", "yarn", "--yes"]);
    expect(args).toEqual({
      directory: "my-app",
      template: "consumer-app",
      templateExplicit: true,
      packageManager: "yarn",
      yes: true,
      sdk: "npm",
      json: false,
      list: false,
      skipAgentFiles: false,
      help: false,
      version: false,
    });
  });

  it("parses --install/--no-install and --git/--no-git (undefined when absent)", () => {
    expect(parseArgs([]).install).toBeUndefined();
    expect(parseArgs([]).git).toBeUndefined();
    expect(parseArgs(["--no-install", "--no-git"])).toMatchObject({ install: false, git: false });
    expect(parseArgs(["--install", "--git"])).toMatchObject({ install: true, git: true });
  });

  it("parses --json, --list and --skip-agent-files", () => {
    expect(parseArgs(["--json", "--list", "--skip-agent-files"])).toMatchObject({
      json: true,
      list: true,
      skipAgentFiles: true,
    });
  });

  it("parses --sdk vendor|npm and rejects anything else", () => {
    expect(parseArgs([]).sdk).toBe("npm");
    expect(parseArgs(["--sdk", "npm"]).sdk).toBe("npm");
    expect(parseArgs(["--sdk", "vendor"]).sdk).toBe("vendor");
    expect(() => parseArgs(["--sdk", "git"])).toThrow(CliArgsError);
    expect(() => parseArgs(["--sdk"])).toThrow(CliArgsError);
  });
});
