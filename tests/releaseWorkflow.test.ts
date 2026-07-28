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
