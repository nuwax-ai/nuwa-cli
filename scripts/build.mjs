/**
 * esbuild build script — bundles nuwa-cli CLI into a single ESM entry.
 *
 * Runtime dependencies that the CLI imports directly are inlined; adapter
 * packages resolved through require.resolve stay as normal npm
 * dependencies. Platform-specific lanproxy binaries are provided by the
 * external @nuwax-ai/lanproxy package family.
 */

import * as esbuild from "esbuild";
import { readFile, rm } from "node:fs/promises";

const pkg = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf-8"),
);
const distDir = new URL("../dist", import.meta.url);
await rm(distDir, { recursive: true, force: true });
await esbuild.build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/cli.js",
  banner: { js: "#!/usr/bin/env node" },
  sourcemap: false,
  minify: false,
  legalComments: "none",
  define: {
    __NUWACLI_VERSION__: JSON.stringify(pkg.version),
    __NUWACLI_DIST_TAG__: JSON.stringify(pkg.publishConfig?.tag || "latest"),
  },
  // These are CJS packages that do runtime `require("node:*")` inside their
  // own module bodies (node-machine-id -> child_process; which -> isexe ->
  // node:fs; write-file-atomic -> signal-exit). esbuild's CJS-in-ESM interop
  // shim can't resolve those dynamically at bundle time ("Dynamic require of X
  // is not supported"), so a bundled copy crashes at runtime. Keep them
  // external and let Node's real loader resolve them from node_modules at
  // runtime. All three are runtime dependencies, so `npm install -g` provides
  // them alongside the tarball.
  external: [
    "node-machine-id",
    "@nuwax-ai/lanproxy",
    "which",
    "write-file-atomic",
  ],
  // Inline the local UI's single-page HTML as a string at build time, so the
  // `ui` server can serve it with no asset pipeline or runtime file reads.
  loader: { ".html": "text" },
  // Keep the (CJK-heavy) inlined HTML as UTF-8 instead of \u-escaping every
  // non-ASCII char — smaller bundle, readable output, served verbatim.
  charset: "utf8",
});
