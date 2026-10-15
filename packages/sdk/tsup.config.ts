import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/react/index.ts",
    privy: "src/privy/index.ts",
    "privy/react": "src/privy/react.ts",
    "privy/wagmi": "src/privy/wagmi.ts",
    "privy/server": "src/privy/server.ts",
    session: "src/session/index.ts",
    "session/server": "src/session/server.ts",
    "session/react": "src/session/react.ts",
    "session/kernel": "src/session/kernel.ts",
    aa: "src/aa/index.ts",
    "aa/kernel": "src/aa/kernel.ts",
    "aa/react": "src/aa/react.ts",
    "aa/react-direct": "src/aa/react-direct.ts",
    paymaster: "src/paymaster/index.ts",
    "paymaster/server": "src/paymaster/server.ts",
    combo: "src/combo/server.ts",
    "combo/react": "src/combo/react.ts",
    server: "src/server.ts",
    doctor: "src/doctor.ts",
  },
  format: ["esm", "cjs"],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
  dts: true,
  sourcemap: true,
  clean: true,
  // Splitting keeps `@zerodev/*` out of the static graph of `aa/react` (its
  // direct transport lazy-loads `./kernel`) and keeps modules shared between
  // entries (e.g. the Privy React context) as single instances.
  splitting: true,
  treeshake: true,
  target: "es2022",
  // `./privy/wagmi` is ESM-only (@privy-io/wagmi ships no CJS build, and
  // package.json declares no `require` condition for it). tsup cannot pick
  // formats per entry, so `scripts/prune-esm-only.mjs` (run by `pnpm build`)
  // deletes that entry's CJS outputs after the build.
  // Every peer is external (tsup also externalizes peerDependencies). `react`
  // is only ever imported from react entries; `@privy-io/*` and `@zerodev/*`
  // only from their own subpaths (enforced by test/boundaries.test.ts).
  external: [
    "react",
    "viem",
    "wagmi",
    "@tanstack/react-query",
    /^@privy-io\//,
    /^@zerodev\//,
  ],
});
