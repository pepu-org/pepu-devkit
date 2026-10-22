import { defineConfig } from "vitest/config";

// The suite spins up real HTTP servers and SQLite files per test. Run test
// files one at a time and allow a generous per-test timeout so a loaded
// machine (CI, or a full `pnpm -r test` running beside it) does not flake.
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
