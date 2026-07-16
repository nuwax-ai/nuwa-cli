/**
 * esbuild inlines `.html` imports as a string (see `loader` in
 * scripts/build.mjs). This ambient declaration lets TypeScript understand
 * those imports during `tsc --noEmit`.
 */
declare module "*.html" {
  const content: string;
  export default content;
}
