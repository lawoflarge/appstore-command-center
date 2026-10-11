// Run with the existing development toolchain; no extra package or paid service is needed.
// node --env-file=/secure/path/.env.local scripts/backfill-revenue.mjs --output=/private/tmp/revenue-audit
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const fromVitest = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(fromVitest.resolve("vite"));
const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({ configFile: false, root, resolve: { alias: { "@": path.join(root, "src") } }, server: { watch: null } });
try {
  const { runBackfill } = await server.ssrLoadModule("/scripts/backfill-revenue.ts");
  await runBackfill(process.argv.slice(2));
} finally {
  await server.close();
}
