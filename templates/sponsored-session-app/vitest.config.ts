import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root("./"),
      // `server-only` throws outside a Next.js server build; tests run in plain Node.
      "server-only": root("./lib/test-stubs/server-only.ts"),
    },
  },
  test: { include: ["lib/**/*.test.ts", "app/**/*.test.ts"] },
});
