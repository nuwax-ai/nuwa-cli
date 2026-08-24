import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Vitest runs through Vite, which — unlike esbuild's `text` loader in
 * scripts/build.mjs — doesn't know how to import the UI's `.html` asset. This
 * pre-transform plugin mirrors the build's text-loader so tests that transit
 * createProgram → uiServer → appHtml.html get the HTML as a default-exported
 * string, exactly as the bundled CLI does.
 */
const htmlTextLoader = {
  name: "nuwacli-html-text",
  enforce: "pre" as const,
  transform(_code: string, id: string) {
    if (!id.endsWith(".html")) return undefined;
    const file = id.startsWith("file:") ? fileURLToPath(id) : id;
    const content = readFileSync(file, "utf-8");
    return { code: `export default ${JSON.stringify(content)};`, map: null };
  },
};

export default defineConfig({
  plugins: [htmlTextLoader],
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.{test,spec}.ts"],
    exclude: ["node_modules", "dist"],
    testTimeout: 15000,
    // Parallel startServeHttp would otherwise contend on the process-wide
    // PersistentMcpBridge (real npx chrome-devtools) and flake stop() past
    // testTimeout. Warmup is still covered in proxyRewriteDefaults with the
    // env unset for that case.
    env: {
      NUWACLI_SKIP_MCP_BRIDGE_WARMUP: "1",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["tests/**", "dist/**", "scripts/**", "**/*.test.ts"],
      reporter: ["text", "json", "html"],
    },
  },
});
