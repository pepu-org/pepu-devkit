/**
 * MCP resources: read-only context an agent (or a person in a client UI) can
 * attach without a tool call.
 *
 *   pepu://chain-facts       verified network facts and the known gotchas
 *   pepu://addresses         the SDK contract registry for mainnet (getPepuAddresses)
 *   pepu://docs/{slug}       a docs page (snapshot of the repo docs, bundled at build time)
 *   pepu://skills/{name}     a PEPU skill's SKILL.md (bundled at build time)
 *   pepu://sdk/exports       every @pepu-chain/sdk import path and its exports
 */

import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getPepuAddresses, pepuMainnet } from "@pepu-chain/sdk";
import { KNOWN_GOTCHAS, MAINNET } from "./constants.js";
import { DOC_PAGES, SDK_EXPORTS, SKILLS, findDocPage, findSkill } from "./snapshots.js";

function json(uri: URL, data: unknown) {
  return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
}

function markdown(uri: URL, text: string) {
  return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
}

function variable(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export function registerAllResources(server: McpServer): void {
  server.registerResource(
    "chain-facts",
    "pepu://chain-facts",
    { title: "PEPU chain facts", description: "Verified Pepe Unchained V2 network facts (chain 97741) and the known gotchas. Mainnet only is buildable; the testnet has no faucet, explorer or contracts.", mimeType: "application/json" },
    (uri) => json(uri, { network: MAINNET, testnetNote: "Testnet 97740 exists but is out of scope: no faucet, no indexed explorer, no deployed infra.", knownGotchas: KNOWN_GOTCHAS })
  );

  server.registerResource(
    "addresses",
    "pepu://addresses",
    { title: "PEPU contract addresses", description: "Every tracked mainnet contract from the @pepu-chain/sdk registry (getPepuAddresses): deployed addresses with notes, retired ones (paymaster v1) flagged, and pending ones with the reason.", mimeType: "application/json" },
    (uri) => json(uri, { chainId: pepuMainnet.id, contracts: getPepuAddresses(pepuMainnet.id) })
  );

  server.registerResource(
    "docs",
    new ResourceTemplate("pepu://docs/{+slug}", {
      list: () => ({ resources: DOC_PAGES.map((p) => ({ uri: `pepu://docs/${p.slug}`, name: p.title, mimeType: "text/markdown" })) }),
      complete: { slug: (value) => DOC_PAGES.map((p) => p.slug).filter((s) => s.startsWith(value)) },
    }),
    { title: "PEPU developer docs", description: "A page of the PEPU developer docs, from a snapshot bundled at build time.", mimeType: "text/markdown" },
    (uri, vars) => {
      const page = findDocPage(variable(vars["slug"]));
      if (!page) throw new Error(`No docs page "${variable(vars["slug"])}". Read pepu://docs/{slug} with a slug from the list.`);
      return markdown(uri, page.content);
    }
  );

  server.registerResource(
    "skills",
    new ResourceTemplate("pepu://skills/{name}", {
      list: () => ({ resources: SKILLS.map((s) => ({ uri: `pepu://skills/${s.name}`, name: s.name, description: s.description, mimeType: "text/markdown" })) }),
      complete: { name: (value) => SKILLS.map((s) => s.name).filter((n) => n.startsWith(value)) },
    }),
    { title: "PEPU agent skills", description: "A PEPU skill (SKILL.md) bundled at build time.", mimeType: "text/markdown" },
    (uri, vars) => {
      const skill = findSkill(variable(vars["name"]));
      if (!skill) throw new Error(`No skill "${variable(vars["name"])}". Available: ${SKILLS.map((s) => s.name).join(", ")}.`);
      return markdown(uri, skill.content);
    }
  );

  server.registerResource(
    "sdk-exports",
    "pepu://sdk/exports",
    { title: "@pepu-chain/sdk exports", description: "Every SDK import path with its exports and one-line summaries, generated from the SDK build.", mimeType: "application/json" },
    (uri) => json(uri, SDK_EXPORTS)
  );
}
