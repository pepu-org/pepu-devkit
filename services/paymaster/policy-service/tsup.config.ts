/**
 * Build config for `npm run build`. Without this file, bare `tsup` (the
 * package.json script) has no entry points and produces nothing.
 *
 * WHY THIS EXISTS: this package's source files use `.js`-suffixed relative
 * imports throughout (e.g. `import { ... } from "./config.js"` inside
 * `index.ts`), following the TypeScript "NodeNext-style" convention that
 * `tsconfig.json`'s `moduleResolution: "Bundler"` accepts at typecheck time
 * (tsc resolves `./config.js` to the sibling `./config.ts` and typechecks
 * clean -- confirmed in this session via `tsc --noEmit`). Node's OWN
 * built-in TypeScript support does NOT do that fallback: running
 * `node --experimental-strip-types src/index.ts` directly on this machine's
 * Node v24.4.1 fails with `ERR_MODULE_NOT_FOUND` the moment it hits the
 * first `./config.js` import, because no `config.js` file actually exists
 * (confirmed directly in this session, including with a minimal two-file
 * repro isolating the exact behavior from anything else in this package).
 * `package.json`'s `start`/`dev` scripts (`node --experimental-strip-types
 * src/index.ts`) therefore do not run as-is on this Node version.
 *
 * tsup (esbuild under the hood) resolves `.js` specifiers against sibling
 * `.ts` source files just fine (esbuild's own long-standing TS-friendly
 * resolution), so building through here and running the compiled output
 * with plain `node` is the fix that requires editing zero of the reviewed
 * source files. See README.md "Running the service" for the exact commands
 * this produces.
 */
import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "cli/hash-api-key": "src/cli/hash-api-key.ts",
    "cli/reset-circuit-breaker": "src/cli/reset-circuit-breaker.ts",
    "cli/reset-spend-counters": "src/cli/reset-spend-counters.ts",
    "cli/monitor-deposit": "src/cli/monitor-deposit.ts",
    "cli/gen-key": "src/cli/gen-key.ts",
    "cli/backup-db": "src/cli/backup-db.ts",
  },
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // node:sqlite is a Node built-in (see db.ts's module doc comment) -- never
  // bundle it, just leave the import as-is for Node to resolve at runtime.
  external: ["node:sqlite"],
});
