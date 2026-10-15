#!/usr/bin/env node
// Opt-in live check: confirms every "deployed" mainnet registry address still
// has bytecode via eth_getCode. NOT part of the unit tests (no network in CI).
//
// Usage (after `pnpm --filter @pepu-chain/sdk build`):
//   node packages/sdk/scripts/live-check.mjs [rpcUrl]
// Covers the chain registry (pepuContracts) and the PepuSwap registry
// (pepuSwapContracts). Exits 1 if any deployed address has no code. Read-only;
// broadcasts nothing.
import { getPepuAddresses, pepuMainnet, pepuSwapContracts } from "../dist/index.js";

const rpc = process.argv[2] ?? "https://rpc-pepu-v2-mainnet-0.t.conduit.xyz";
let failed = 0;

async function codeSize(address, id) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "eth_getCode", params: [address, "latest"] }),
  });
  const { result } = await res.json();
  return typeof result === "string" ? (result.length - 2) / 2 : 0;
}

for (const row of getPepuAddresses(pepuMainnet.id)) {
  if (row.status !== "deployed" || !row.address) {
    console.log(`SKIP  ${row.key} (pending)`);
    continue;
  }
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getCode",
      params: [row.address, "latest"],
    }),
  });
  const { result } = await res.json();
  const bytes = typeof result === "string" ? (result.length - 2) / 2 : 0;
  if (bytes > 0) {
    console.log(`OK    ${row.key} ${row.address} (${bytes} bytes, last verified ${row.verifiedAt ?? "never"})`);
  } else {
    failed++;
    console.log(`FAIL  ${row.key} ${row.address} has no code`);
  }
}

// PepuSwap (third-party DEX) addresses. They live in their own registry.
for (const [key, row] of Object.entries(pepuSwapContracts[pepuMainnet.id] ?? {})) {
  if (row.status !== "deployed") {
    console.log(`SKIP  pepuswap.${key} (pending)`);
    continue;
  }
  const bytes = await codeSize(row.address, 3);
  if (bytes > 0) {
    console.log(`OK    pepuswap.${key} ${row.address} (${bytes} bytes)`);
  } else {
    failed++;
    console.log(`FAIL  pepuswap.${key} ${row.address} has no code`);
  }
}

// The canonical Multicall3 must stay empty on this chain.
const canon = await fetch(rpc, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "eth_getCode",
    params: ["0xcA11bde05977b3631167028862bE2a173976CA11", "latest"],
  }),
}).then((r) => r.json());
console.log(`INFO  canonical Multicall3 code: ${canon.result === "0x" ? "empty (expected)" : "PRESENT (registry may need updating)"}`);

process.exit(failed ? 1 : 0);
