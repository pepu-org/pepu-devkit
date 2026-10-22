#!/usr/bin/env node
/**
 * Build-time snapshots bundled into the package so the published MCP server
 * needs no repository checkout:
 *
 *   src/generated/docs.json         the repo's docs/ folder (pages and sections)
 *   src/generated/skills.json       the repo's skills/*\/SKILL.md files
 *   src/generated/templates.json    create-pepu-app's templates.json registry
 *   src/generated/sdk-exports.json  the export list of every @pepu-chain/sdk subpath
 *
 * The generated files are committed so `pnpm test` and `pnpm typecheck` work on
 * a fresh checkout; `pnpm build` regenerates them first. If a source is not
 * present (for example the package is built outside the monorepo) the existing
 * snapshot is kept. The SDK export list needs `packages/sdk/dist` (run
 * `pnpm --filter @pepu-chain/sdk build` first).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const repoRoot = path.resolve(pkgRoot, "..", "..");
const outDir = path.join(pkgRoot, "src", "generated");
fs.mkdirSync(outDir, { recursive: true });

const DOCS_BASE_URL = "https://docs.pepeunchained.com";

function write(name, data) {
  fs.writeFileSync(path.join(outDir, name), JSON.stringify(data, null, 2) + "\n");
}

function walk(dir, filter) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out.sort();
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

// ---------------------------------------------------------------- docs
function buildDocs() {
  const docsDir = path.join(repoRoot, "docs");
  if (!fs.existsSync(docsDir)) return false;
  const files = walk(docsDir, (f) => f.endsWith(".md"));
  const pages = files.map((file) => {
    const rel = toPosix(path.relative(docsDir, file));
    const slug = rel.replace(/\.md$/, "");
    const content = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const titleMatch = /^#\s+(.+)$/m.exec(content);
    return {
      slug,
      title: titleMatch ? titleMatch[1].trim() : slug,
      url: slug === "README" ? DOCS_BASE_URL : `${DOCS_BASE_URL}/${slug}`,
      content,
    };
  });
  write("docs.json", { generatedFrom: "docs/", baseUrl: DOCS_BASE_URL, pages });
  return true;
}

// ---------------------------------------------------------------- skills
function buildSkills() {
  const skillsDir = path.join(repoRoot, "skills");
  if (!fs.existsSync(skillsDir)) return false;
  const skills = [];
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(skillsDir, entry.name, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const desc = /^description:\s*(.+)$/m.exec(content);
    skills.push({ name: entry.name, description: desc ? desc[1].trim() : "", content });
  }
  write("skills.json", { generatedFrom: "skills/*/SKILL.md", skills });
  return true;
}

// ---------------------------------------------------------------- templates
function buildTemplates() {
  const src = path.join(repoRoot, "packages", "create-pepu-app", "src", "templates.json");
  if (!fs.existsSync(src)) return false;
  fs.copyFileSync(src, path.join(outDir, "templates.json"));
  return true;
}

// ---------------------------------------------------------------- sdk exports
function firstSentenceOf(jsdoc) {
  const body = jsdoc
    .replace(/^\/\*\*+/, "")
    .replace(/\*+\/$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, ""))
    .join("\n");
  const head = body.split(/\n\s*\n|\n\s*@/)[0] ?? "";
  const flat = head.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const dot = flat.search(/\.(\s|$)/);
  const sentence = dot >= 0 ? flat.slice(0, dot + 1) : flat;
  return sentence.length > 220 ? sentence.slice(0, 217) + "..." : sentence;
}

function buildSdkExports() {
  const sdkDir = path.join(repoRoot, "packages", "sdk");
  const distDir = path.join(sdkDir, "dist");
  if (!fs.existsSync(distDir)) return false;
  const sdkPkg = JSON.parse(fs.readFileSync(path.join(sdkDir, "package.json"), "utf8"));

  // Summaries: the JSDoc block right before each `declare <kind> <name>` in any d.ts.
  const summaries = new Map();
  const kinds = new Map();
  for (const file of walk(distDir, (f) => f.endsWith(".d.ts"))) {
    const text = fs.readFileSync(file, "utf8");
    const re = /(\/\*\*[\s\S]*?\*\/\s*)?(?:export\s+)?declare\s+(function|const|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/g;
    let m;
    while ((m = re.exec(text))) {
      const [, doc, kind, name] = m;
      if (!kinds.has(name)) kinds.set(name, kind);
      if (doc && !summaries.has(name)) {
        const s = firstSentenceOf(doc.trim());
        if (s) summaries.set(name, s);
      }
    }
  }

  const result = {};
  for (const [subpath, target] of Object.entries(sdkPkg.exports)) {
    if (subpath === "./package.json") continue;
    const typesRel = typeof target === "object" ? target.types : undefined;
    if (!typesRel) continue;
    const dts = path.join(sdkDir, typesRel);
    if (!fs.existsSync(dts)) continue;
    const text = fs.readFileSync(dts, "utf8");
    const names = new Map(); // exported name -> local name (for alias exports)
    const blocks = [...text.matchAll(/export\s*(type\s*)?\{([^}]*)\}(?:\s*from\s*['"][^'"]+['"])?/g)];
    for (const b of blocks) {
      const wholeType = !!b[1];
      for (let item of b[2].split(",")) {
        item = item.trim();
        if (!item) continue;
        let isType = wholeType;
        if (item.startsWith("type ")) {
          isType = true;
          item = item.slice(5).trim();
        }
        const [local, exported] = item.split(/\s+as\s+/).map((x) => x.trim());
        names.set(exported ?? local, { local, isType });
      }
    }
    // Direct `export declare`/`declare` + inline exports are rare in tsup output but handle `export declare`.
    for (const m of text.matchAll(/export\s+declare\s+(function|const|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/g)) {
      names.set(m[2], { local: m[2], isType: m[1] === "interface" || m[1] === "type" });
    }
    const label = subpath === "." ? "@pepu-chain/sdk" : `@pepu-chain/sdk/${subpath.slice(2)}`;
    const entries = [...names.entries()]
      .map(([name, { local, isType }]) => {
        const kind = kinds.get(local) ?? kinds.get(name);
        const finalKind =
          isType || kind === "interface" || kind === "type" ? "type" : kind === "function" ? "function" : kind === "class" ? "class" : kind === "enum" ? "enum" : "value";
        return { name, kind: finalKind, summary: summaries.get(local) ?? summaries.get(name) ?? "" };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    result[label] = entries;
  }
  write("sdk-exports.json", { sdkVersion: sdkPkg.version, subpaths: result });
  return true;
}

const report = {
  docs: buildDocs(),
  skills: buildSkills(),
  templates: buildTemplates(),
  sdkExports: buildSdkExports(),
};
console.error(`[pepu-mcp] snapshots: ${Object.entries(report).map(([k, v]) => `${k}=${v ? "updated" : "kept"}`).join(" ")}`);
