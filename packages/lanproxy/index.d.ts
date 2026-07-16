export declare const supportedPlatforms: readonly string[];

export declare function packageNameForPlatform(
  platform?: string,
  arch?: string,
): string | undefined;

export declare function resolveBinaryPath(
  platform?: string,
  arch?: string,
): string;
