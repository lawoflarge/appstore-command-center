import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: { provider: "v8", reportsDirectory: "./archive/coverage" },
    server: {
      deps: {
        // next-auth@5 beta imports "next/server" (no .js extension) which fails Node ESM
        // strict resolution. Inlining forces Vite to transform them using its own resolver
        // which handles extension-less imports.
        inline: [/next-auth/, /@auth\/core/],
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
