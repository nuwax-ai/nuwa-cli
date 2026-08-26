declare const __NUWACLI_VERSION__: string | undefined;
declare const __NUWACLI_DIST_TAG__: string | undefined;

export const PACKAGE_NAME = "@nuwax-ai/nuwa-cli";

export const CLI_VERSION =
  typeof __NUWACLI_VERSION__ === "string" && __NUWACLI_VERSION__
    ? __NUWACLI_VERSION__
    : "0.0.0-dev";

export const DEFAULT_DIST_TAG =
  typeof __NUWACLI_DIST_TAG__ === "string" && __NUWACLI_DIST_TAG__
    ? __NUWACLI_DIST_TAG__
    : "beta";

/**
 * Product / S3 channel names that are not npm dist-tags.
 * npm publishes stable builds under `latest` (see release-stable.mjs).
 */
export const NPM_CHANNEL_ALIASES: Readonly<Record<string, string>> = {
  stable: "latest",
};

/** Map `stable` → `latest`; leave other tags/versions unchanged. */
export function resolveNpmChannelAlias(raw: string): {
  target: string;
  aliasedFrom?: string;
} {
  const aliased = NPM_CHANNEL_ALIASES[raw.toLowerCase()];
  if (aliased) return { target: aliased, aliasedFrom: raw };
  return { target: raw };
}
