import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests for Kold Lite's on-device engine (web/src/local). Run: npm test
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    setupFiles: ["test/setup.ts"],
    testTimeout: 30_000,
  },
});
