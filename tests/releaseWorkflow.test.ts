import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("beta release workflow", () => {
  it("publishes, syncs only nuwa-cli, verifies npmmirror, then publishes S3", () => {
    const script = fs.readFileSync(
      path.join(process.cwd(), "scripts", "release-beta.mjs"),
      "utf8",
    );
    const publish = script.indexOf('"publish"');
    const sync = script.indexOf('run("cnpm", ["sync", pkg.name])');
    const verify = script.indexOf("await waitForMirror()");
    const s3 = script.indexOf('run("bash", [');

    expect(publish).toBeGreaterThan(-1);
    expect(sync).toBeGreaterThan(publish);
    expect(verify).toBeGreaterThan(sync);
    expect(s3).toBeGreaterThan(verify);
    expect(script).not.toContain('cnpm", ["sync", "@nuwax-ai/lanproxy');
    // 发布前强制核验核心依赖 exact pin（相对 registry latest）。
    expect(script).toContain('scripts/sync-core-deps.mjs", "--check"');
  });

  it("is wired to npm run release:beta with a dry-run companion", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    );

    expect(pkg.scripts["release:beta"]).toBe(
      "node scripts/release-beta.mjs",
    );
    expect(pkg.scripts["release:beta:dry-run"]).toContain("--dry-run");
  });
});

describe("stable release workflow", () => {
  it("publishes with --tag latest and --ignore-scripts, then S3 stable", () => {
    const script = fs.readFileSync(
      path.join(process.cwd(), "scripts", "release-stable.mjs"),
      "utf8",
    );
    expect(script).toContain('"--tag"');
    expect(script).toContain('"latest"');
    expect(script).toContain('"--ignore-scripts"');
    expect(script).toContain('"--channel"');
    expect(script).toContain('"stable"');
    expect(script).toContain('scripts/sync-core-deps.mjs", "--check"');
  });

  it("is wired to npm run release:stable with a dry-run companion", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    );
    expect(pkg.scripts["release:stable"]).toBe(
      "node scripts/release-stable.mjs",
    );
    expect(pkg.scripts["release:stable:dry-run"]).toContain("--dry-run");
  });
});
