import { DEFAULT_TEMPLATE, TEMPLATES, featureSummary } from "./templates.js";
import { isPackageManagerName, type PackageManagerName } from "./package-manager.js";

export interface CliArgs {
  directory?: string;
  template: string;
  /**
   * True when `--template`/`-t` was actually passed on the command line,
   * false when `template` is just sitting at its `DEFAULT_TEMPLATE`
   * fallback. Lets the interactive flow (see `src/index.ts`) decide
   * whether to prompt for a template choice — it shouldn't if the caller
   * already picked one explicitly.
   */
  templateExplicit: boolean;
  yes: boolean;
  /** `--install` / `--no-install`; undefined = ask (interactive) or the default (install). */
  install?: boolean;
  /** `--git` / `--no-git`; undefined = ask (interactive) or the default (git init). */
  git?: boolean;
  /** `--sdk vendor|npm`. Default npm; falls back to vendor if the SDK is not on the registry. */
  sdk: "vendor" | "npm";
  /** Machine-readable result on stdout; implies non-interactive. */
  json: boolean;
  /** Print the template registry and exit. */
  list: boolean;
  skipAgentFiles: boolean;
  packageManager?: PackageManagerName;
  help: boolean;
  version: boolean;
}

export class CliArgsError extends Error {}

/**
 * A small hand-rolled parser instead of a dependency like commander/yargs
 * — this CLI's surface is a dozen flags and one positional argument, and
 * keeping the dependency count near zero keeps `npx create-pepu-app`
 * fast on a cold cache.
 */
export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    template: DEFAULT_TEMPLATE,
    templateExplicit: false,
    yes: false,
    sdk: "npm",
    json: false,
    list: false,
    skipAgentFiles: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;

    switch (token) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--version":
      case "-v":
        args.version = true;
        break;
      case "--yes":
      case "-y":
        args.yes = true;
        break;
      case "--install":
        args.install = true;
        break;
      case "--no-install":
        args.install = false;
        break;
      case "--git":
        args.git = true;
        break;
      case "--no-git":
        args.git = false;
        break;
      case "--json":
        args.json = true;
        break;
      case "--list":
        args.list = true;
        break;
      case "--skip-agent-files":
        args.skipAgentFiles = true;
        break;
      case "--sdk": {
        const value = argv[++i];
        if (value !== "vendor" && value !== "npm") {
          throw new CliArgsError(`--sdk requires "vendor" or "npm"${value ? ` (got "${value}")` : ""}`);
        }
        args.sdk = value;
        break;
      }
      case "--template":
      case "-t": {
        const value = argv[++i];
        if (!value) throw new CliArgsError(`${token} requires a value, e.g. ${token} consumer-app`);
        args.template = value;
        args.templateExplicit = true;
        break;
      }
      case "--pm": {
        const value = argv[++i];
        if (!value) throw new CliArgsError(`--pm requires a value (npm, pnpm, yarn, or bun)`);
        if (!isPackageManagerName(value)) {
          throw new CliArgsError(`--pm "${value}" is not one of: npm, pnpm, yarn, bun`);
        }
        args.packageManager = value;
        break;
      }
      default: {
        if (token.startsWith("-")) {
          throw new CliArgsError(`Unrecognized option "${token}". Run with --help to see usage.`);
        }
        if (args.directory !== undefined) {
          throw new CliArgsError(`Unexpected extra argument "${token}" — only one project directory is accepted.`);
        }
        args.directory = token;
        break;
      }
    }
  }

  return args;
}

const TEMPLATE_LIST_TEXT = TEMPLATES.map((t) => `  ${t.name.padEnd(24)}${t.description}`).join("\n");

export const HELP_TEXT = `
Usage: create-pepu-app [directory] [options]

Scaffold a PEPU developer kit starter template.

Arguments:
  directory              Where to create the project (default: prompted, or
                          "./pepu-app" with --yes)

Options:
  -t, --template <name>  Template to scaffold (default: consumer-app)
  -y, --yes              Skip prompts and accept defaults (installs and runs
                          git init unless you pass --no-install / --no-git)
      --pm <manager>     Package manager: npm, pnpm, yarn, or bun
                          (default: auto-detected)
      --install          Install dependencies after scaffolding
      --no-install       Skip the install
      --git              Run git init
      --no-git           Skip git init
      --sdk <mode>       How the app depends on @pepu-chain/sdk: "npm"
                          (registry range, default; falls back to vendor if
                          not published) or "vendor" (bundled file: copy).
      --skip-agent-files Leave out AGENTS.md and CLAUDE.md
      --json             Print one JSON result on stdout (path, template, next
                          steps, required env). Implies --yes; for agents.
      --list             List templates and exit (with --json: as JSON)
  -h, --help             Show this help
  -v, --version          Show the CLI version

Templates:
${TEMPLATE_LIST_TEXT}

Examples:
  npx create-pepu-app
  npx create-pepu-app my-app --yes
  npm create pepu-app@latest my-app -- --pm pnpm
  npx create-pepu-app my-app --template token-gated-app --yes
`.trim();
