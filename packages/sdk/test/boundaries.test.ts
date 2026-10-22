import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

// `vi.mock` calls are hoisted above imports by vitest regardless of where
// they appear in the file. If the core import graph ever reaches "react",
// importing the core entry point below throws through this mock instead of
// silently succeeding, so this is a behavioral check, not just a text search.
vi.mock("react", () => {
  throw new Error("@pepu-chain/sdk core must never import react");
});

const srcDir = fileURLToPath(new URL("../src", import.meta.url));
const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));

function collectTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectTsFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

/** Path relative to src/, posix separators, e.g. "privy/react.ts". */
const rel = (file: string): string => path.relative(srcDir, file).split(path.sep).join("/");

const files = collectTsFiles(srcDir).map((f) => ({ rel: rel(f), text: readFileSync(f, "utf-8") }));

/** Bare (package) specifiers a file imports or re-exports, type imports included. */
function bareImports(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"'./][^"']*)["']/g)) {
    if (m[1] !== undefined) out.push(m[1]);
  }
  return out;
}

/** Relative imports resolved to a src-relative path without extension. */
function relativeImports(file: string, text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']*)["']/g)) {
    if (m[1] === undefined) continue;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1]));
    out.push(resolved.replace(/\.js$/, ""));
  }
  return out;
}

const isReactEntry = (f: string): boolean => f.startsWith("react/") || /(^|\/)react(-direct)?\.ts$/.test(f);

/**
 * Which source files may import which package. Keys ending in "/" are
 * prefixes (`@zerodev/`); every other key matches that exact specifier only,
 * so a Privy subpath such as `@privy-io/react-auth/smart-wallets` needs its own
 * row. A `@privy-io/*` specifier with no row is an offender, so adding a new
 * Privy import forces a decision here.
 *
 * Kernel (ZeroDev) code lives only in the two kernel entries; `combo/*` reaches
 * it through them, never directly.
 */
const ALLOWED: Record<string, (f: string) => boolean> = {
  react: isReactEntry,
  "@privy-io/react-auth": (f) => ["privy/react.ts", "session/react.ts", "aa/react.ts", "aa/react-direct.ts", "combo/react.ts"].includes(f),
  "@privy-io/react-auth/smart-wallets": (f) => f === "aa/react.ts",
  "@privy-io/wagmi": (f) => f === "privy/wagmi.ts",
  wagmi: (f) => f === "privy/wagmi.ts",
  "@tanstack/react-query": (f) => f === "privy/wagmi.ts",
  "@privy-io/node": (f) => ["privy/server.ts", "session/server.ts", "combo/server.ts"].includes(f),
  "@zerodev/": (f) => ["session/kernel.ts", "aa/kernel.ts"].includes(f),
};

function ruleFor(spec: string): string | undefined {
  const keys = Object.keys(ALLOWED);
  const exact = keys.find((k) => (k.endsWith("/") ? spec.startsWith(k) : spec === k));
  if (exact) return exact;
  // Subpaths of a package follow the package's rule, except `@privy-io/react-auth`:
  // each of its subpaths must be listed explicitly above.
  return keys.find((k) => !k.endsWith("/") && k !== "@privy-io/react-auth" && spec.startsWith(`${k}/`));
}

describe("import boundaries", () => {
  it("scans a non-trivial set of source files", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("react, @privy-io/*, wagmi and @zerodev/* are imported only from their allowed entries", () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const spec of bareImports(f.text)) {
        const rule = ruleFor(spec);
        if (rule !== undefined) {
          if (!ALLOWED[rule]?.(f.rel)) offenders.push(`${f.rel} imports ${spec}`);
        } else if (spec.startsWith("@privy-io/") || spec.startsWith("wagmi/") || spec.startsWith("react/")) {
          offenders.push(`${f.rel} imports ${spec}, which has no boundary rule`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("Privy client entries never reference the kernel modules, statically or dynamically (so @zerodev stays optional)", () => {
    // Bundlers resolve dynamic import() at build time too, so even a lazy
    // import would force @zerodev onto a Privy-Smart-Wallets-only app. The
    // direct transport lives in aa/react-direct.
    const offenders: string[] = [];
    for (const rel of ["aa/react.ts", "privy/react.ts", "session/react.ts"]) {
      const text = files.find((x) => x.rel === rel)?.text ?? "";
      // Type-only imports are erased, so they do not count.
      for (const m of text.matchAll(/(?:^|\n)\s*(import|export)(\s+type)?\s[^;]*?from\s*["']([^"']*kernel[^"']*)["']/g)) {
        if (!m[2]) offenders.push(`${rel} statically imports ${m[3]}`);
      }
      for (const m of text.matchAll(/import\(\s*["']([^"']*(?:kernel|zerodev)[^"']*)["']\s*\)/g)) {
        offenders.push(`${rel} dynamically imports ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  const SERVER_MODULES = ["privy/server", "session/server", "paymaster/server", "combo/server", "server"];

  it("every server module calls assertServerOnly", () => {
    for (const s of SERVER_MODULES) {
      const f = files.find((x) => x.rel === `${s}.ts`);
      expect(f, `${s}.ts exists`).toBeDefined();
      expect(f?.text).toMatch(/assertServerOnly\(/);
    }
  });

  it("only server modules import server modules (client entries never reach them)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (SERVER_MODULES.includes(f.rel.replace(/\.ts$/, ""))) continue;
      for (const target of relativeImports(f.rel, f.text)) {
        if (SERVER_MODULES.includes(target)) offenders.push(`${f.rel} imports ${target}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("core files (outside the entry directories) import only viem", () => {
    const entryDirs = /^(react|privy|session|aa|paymaster|combo)\//;
    const entryFiles = new Set(["server.ts", "doctor.ts"]);
    const offenders: string[] = [];
    for (const f of files) {
      if (entryDirs.test(f.rel) || entryFiles.has(f.rel)) continue;
      for (const spec of bareImports(f.text)) {
        if (spec !== "viem" && !spec.startsWith("viem/") && !spec.startsWith("node:")) {
          offenders.push(`${f.rel} imports ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it(
    "importing the core entry point succeeds even if resolving `react` would throw",
    // Mocking "react" forces vitest to re-transform this package's whole
    // module graph from scratch; give it room on a loaded machine.
    async () => {
      await expect(import("../src/index.js")).resolves.toBeDefined();
    },
    20_000,
  );

  it("the ./server barrel still exposes the pure server helpers", async () => {
    const barrel = await import("../src/server.js");
    const policy = await import("../src/session/policy.js");
    for (const name of Object.keys(policy)) {
      expect(barrel, name).toHaveProperty(name);
    }
  });

  it("package.json: every peer except viem is optional", () => {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };
    const peers = Object.keys(pkg.peerDependencies ?? {});
    expect(peers).toEqual(
      expect.arrayContaining(["viem", "react", "@privy-io/node", "@privy-io/react-auth", "@zerodev/sdk"]),
    );
    for (const p of peers.filter((x) => x !== "viem")) {
      expect(pkg.peerDependenciesMeta?.[p]?.optional, p).toBe(true);
    }
  });
});
