import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  scrubSecretsInText,
  textLooksSecretish,
  scrubSecretsInLogFile,
} from "../src/util/secretScrub.js";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-scrub-"));
afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("scrubSecretsInText", () => {
  it("redacts gateway ak- bearer tokens (plain and inside JSON dumps)", () => {
    const line =
      '{"config":{"experimental_bearer_token":"ak-1709904dc3a04dedae2bfde147910034"}}';
    const out = scrubSecretsInText(line);
    expect(out).not.toContain("ak-1709904dc3a04dedae2bfde147910034");
    expect(out).toContain('"experimental_bearer_token":"(redacted)"');
    // JSON remains parseable — only the value changed.
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it("redacts bare ak- tokens appearing outside JSON key/value form", () => {
    expect(scrubSecretsInText("token=ak-1709904dc3a04dedae2bfde147910034")).toBe(
      "token=ak-REDACTED",
    );
  });

  it("redacts X-Nuwax-Internal-Secret header values", () => {
    const out = scrubSecretsInText(
      "X-Nuwax-Internal-Secret: 33c6f55cc870e643c8ae52d293c30a21115829135683c5cd\n",
    );
    expect(out).toBe("X-Nuwax-Internal-Secret: REDACTED\n");
  });

  it("redacts long Bearer tokens but not the word Bearer alone", () => {
    expect(scrubSecretsInText("Authorization: Bearer abc123def456ghi789")).toBe(
      "Authorization: Bearer REDACTED",
    );
    expect(scrubSecretsInText("uses the Bearer scheme")).toBe(
      "uses the Bearer scheme",
    );
  });

  it("redacts long secret-shaped JSON values without touching usage counters", () => {
    const out = scrubSecretsInText(
      '{"api_key":"sk-verylongsecretvalue","input_tokens":42,"totalTokens":100}',
    );
    expect(out).toContain('"api_key":"(redacted)"');
    expect(out).toContain('"input_tokens":42');
    expect(out).toContain('"totalTokens":100');
  });

  it("leaves ordinary log text untouched", () => {
    const text =
      '{"scope":"serve.http","message":"request","meta":{"path":"/health","queryAuthKeys":[]}}\n';
    expect(scrubSecretsInText(text)).toBe(text);
    expect(textLooksSecretish(text)).toBe(false);
  });
});

describe("scrubSecretsInLogFile", () => {
  it("rewrites a file only when it contains secret-shaped values", () => {
    const dirty = path.join(tmpRoot, "dirty.log");
    const clean = path.join(tmpRoot, "clean.log");
    fs.writeFileSync(
      dirty,
      'line1\n[IN] {"experimental_bearer_token":"ak-1709904dc3a04dedae2bfde147910034"}\n',
      "utf8",
    );
    fs.writeFileSync(clean, "just an ordinary line\n", "utf8");

    expect(scrubSecretsInLogFile(dirty)).toBe(true);
    expect(fs.readFileSync(dirty, "utf8")).not.toContain(
      "ak-1709904dc3a04dedae2bfde147910034",
    );
    expect(fs.readFileSync(dirty, "utf8")).toContain('"(redacted)"');
    expect(scrubSecretsInLogFile(clean)).toBe(false);
    expect(fs.readFileSync(clean, "utf8")).toBe("just an ordinary line\n");
  });

  it("returns false for missing files instead of throwing", () => {
    expect(scrubSecretsInLogFile(path.join(tmpRoot, "nope.log"))).toBe(false);
  });
});
