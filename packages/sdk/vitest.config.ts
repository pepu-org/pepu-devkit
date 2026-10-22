import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    restoreMocks: true,
    // Cold-loading the Privy and ZeroDev peers (exports.test.ts) exceeds the 5s default.
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
