/**
 * Force English UI strings for the whole Vitest suite.
 *
 * Many tests assert English copy. Developers with zh locale or
 * `~/.nuwa-cli/config.json` lang=zh-CN would otherwise fail the gate
 * (and block `release:beta`).
 *
 * Intentionally does NOT import i18n / setLang here: setupFiles run before
 * per-file `vi.mock("node:os")` (e.g. i18n.test.ts), and importing paths
 * early would pin the real homedir and leak host config into those tests.
 *
 * NUWACLI_LANG=en is also set in vitest.config.ts `test.env`. i18n.test.ts
 * clears that env in its own beforeEach when exercising detection.
 */
import { beforeEach } from "vitest";

beforeEach(() => {
  // Re-pin after suites that delete NUWACLI_LANG (except when the current
  // file immediately clears it again in its own beforeEach).
  process.env.NUWACLI_LANG ??= "en";
});
