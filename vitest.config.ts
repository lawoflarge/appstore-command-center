import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: { provider: "v8", reportsDirectory: "./archive/coverage" },
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
