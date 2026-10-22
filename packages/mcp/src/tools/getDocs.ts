/**
 * pepu_get_docs
 *
 * WHAT: Serves pages and sections of the PEPU developer docs from a snapshot
 * of the repo's docs/ folder bundled into this package at build time (no
 * network, no repository checkout needed). Search by `query`, fetch a whole
 * page by `slug`, or list every page.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { STATIC_READ } from "../annotations.js";
import { actionableError } from "../errors.js";
import { jsonResult } from "../format.js";
import { DOC_PAGES, findDocPage, searchDocs } from "../snapshots.js";

const MAX_CHARS = 14_000;

const inputSchema = {
  query: z.string().min(2).optional().describe("What you need to know, in a few words, e.g. 'privy allowed origins port' or 'sponsored session'. Returns the best matching sections."),
  slug: z.string().optional().describe("A page slug from the index, e.g. onboarding/session-keys. Returns the whole page (long pages are truncated, then ask for a section via query)."),
};

function clip(text: string): { text: string; truncated: boolean } {
  return text.length <= MAX_CHARS ? { text, truncated: false } : { text: text.slice(0, MAX_CHARS), truncated: true };
}

export function registerGetDocsTool(server: McpServer): void {
  server.registerTool(
    "pepu_get_docs",
    {
      title: "PEPU developer docs",
      description:
        "Read the PEPU developer docs from a snapshot of the repo's docs/ folder bundled at build time (no network). query returns the best-matching sections with their docs.pepeunchained.com URL; slug returns a whole page; no arguments lists every page. Use it for chain facts, Privy setup, session keys, sponsorship, recipes and troubleshooting before guessing. Docs describe the SDK (@pepu-chain/sdk); for exact exports use pepu_sdk_exports, for working code pepu_sdk_snippet.",
      inputSchema,
      annotations: STATIC_READ,
    },
    async ({ query, slug }) => {
      if (slug !== undefined) {
        const page = findDocPage(slug);
        if (!page) {
          const close = DOC_PAGES.filter((p) => p.slug.toLowerCase().includes(slug.trim().toLowerCase().split("/").pop() ?? "")).slice(0, 5).map((p) => p.slug);
          actionableError(`No docs page "${slug}".`, close.length ? `Close matches: ${close.join(", ")}.` : "It is not in the bundled snapshot.", "Call pepu_get_docs with no arguments to list every slug, or use query.");
        }
        const { text, truncated } = clip(page.content);
        return jsonResult({ slug: page.slug, title: page.title, url: page.url, truncated, content: text });
      }

      if (query !== undefined) {
        const hits = searchDocs(query, 5);
        if (hits.length === 0) {
          return jsonResult({ query, matches: [], hint: "No section matched. Try fewer or different words, or list every page by calling with no arguments." });
        }
        const [best, ...rest] = hits;
        const bestSection = best?.section;
        const clipped = clip(bestSection?.content ?? "");
        return jsonResult({
          query,
          best: {
            slug: bestSection?.slug,
            page: bestSection?.pageTitle,
            heading: bestSection?.heading,
            url: bestSection?.url,
            truncated: clipped.truncated,
            content: clipped.text,
          },
          otherMatches: rest.map((h) => ({ slug: h.section.slug, page: h.section.pageTitle, heading: h.section.heading, url: h.section.url, score: h.score })),
          note: "Snapshot of the repo docs folder bundled at build time. Fetch a whole page with slug.",
        });
      }

      return jsonResult({
        pages: DOC_PAGES.map((p) => ({ slug: p.slug, title: p.title, url: p.url })),
        note: "Pass slug for a whole page or query to search. Snapshot of the repo docs folder bundled at build time.",
      });
    }
  );
}
