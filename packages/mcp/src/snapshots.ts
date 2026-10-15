/**
 * Typed access to the build-time snapshots in ./generated (see
 * scripts/build-snapshots.mjs). Nothing here touches the filesystem at run
 * time, so the published package works with no repository checkout.
 */

import docsSnapshot from "./generated/docs.json";
import skillsSnapshot from "./generated/skills.json";
import templatesSnapshot from "./generated/templates.json";
import sdkExportsSnapshot from "./generated/sdk-exports.json";

export interface DocPage {
  slug: string;
  title: string;
  url: string;
  content: string;
}

export interface DocSection {
  slug: string;
  pageTitle: string;
  url: string;
  heading: string;
  level: number;
  content: string;
}

export interface SkillDoc {
  name: string;
  description: string;
  content: string;
}

/** The fields create-pepu-app's templates.json carries today; extra fields are passed through. */
export interface TemplateRegistryEntry {
  name: string;
  description: string;
  [extra: string]: unknown;
}

export interface SdkExportEntry {
  name: string;
  kind: "function" | "value" | "type" | "class" | "enum";
  summary: string;
}

export const DOC_PAGES: readonly DocPage[] = (docsSnapshot as unknown as { pages: DocPage[] }).pages;
export const SKILLS: readonly SkillDoc[] = (skillsSnapshot as unknown as { skills: SkillDoc[] }).skills;
export const TEMPLATE_REGISTRY: readonly TemplateRegistryEntry[] = templatesSnapshot as unknown as TemplateRegistryEntry[];
export const SDK_EXPORTS: { sdkVersion: string; subpaths: Record<string, SdkExportEntry[]> } =
  sdkExportsSnapshot as unknown as { sdkVersion: string; subpaths: Record<string, SdkExportEntry[]> };

export function findDocPage(slug: string): DocPage | undefined {
  const wanted = slug.trim().replace(/^\/+|\/+$/g, "").replace(/\.md$/, "").toLowerCase();
  return DOC_PAGES.find((p) => p.slug.toLowerCase() === wanted);
}

export function findSkill(name: string): SkillDoc | undefined {
  const wanted = name.trim().toLowerCase();
  return SKILLS.find((s) => s.name.toLowerCase() === wanted);
}

/** Split a markdown page at `#`, `##` and `###` headings (ignoring headings inside code fences). */
export function splitSections(page: Pick<DocPage, "slug" | "title" | "url" | "content">): DocSection[] {
  const sections: DocSection[] = [];
  let heading = page.title;
  let level = 1;
  let lines: string[] = [];
  let inFence = false;
  const flush = (): void => {
    const content = lines.join("\n").trim();
    if (content !== "") {
      sections.push({ slug: page.slug, pageTitle: page.title, url: page.url, heading, level, content });
    }
  };
  for (const line of page.content.split("\n")) {
    if (/^```/.test(line)) inFence = !inFence;
    const m = !inFence ? /^(#{1,3})\s+(.*)$/.exec(line) : null;
    if (m && m[1] && m[2]) {
      flush();
      heading = m[2].trim();
      level = m[1].length;
      lines = [];
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

const STOP_WORDS = new Set(["the", "a", "an", "to", "of", "and", "or", "in", "on", "for", "is", "it", "how", "do", "i", "my", "with", "pepu"]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

export interface DocHit {
  section: DocSection;
  score: number;
}

/** Rank every section of every page against the query. Heading and title hits weigh more than body hits. */
export function searchDocs(query: string, limit = 5): DocHit[] {
  const tokens = [...new Set(tokenize(query))];
  if (tokens.length === 0) return [];
  const hits: DocHit[] = [];
  for (const page of DOC_PAGES) {
    for (const section of splitSections(page)) {
      const heading = section.heading.toLowerCase();
      const title = section.pageTitle.toLowerCase();
      const slug = section.slug.toLowerCase();
      const body = section.content.toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (heading.includes(t)) score += 6;
        if (title.includes(t)) score += 3;
        if (slug.includes(t)) score += 2;
        const count = body.split(t).length - 1;
        if (count > 0) score += Math.min(count, 5);
      }
      if (score > 0) hits.push({ section, score });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
