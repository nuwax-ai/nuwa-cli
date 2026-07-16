import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("withSensitiveAccess", () => {
  let tmpHome: string;
  let prevLock: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-gate-"));
    prevLock = process.env.NUWACLI_SERVE_LOCK_PATH;
    process.env.NUWACLI_SERVE_LOCK_PATH = path.join(tmpHome, "serve.lock");
  });

  afterEach(() => {
    if (prevLock === undefined) delete process.env.NUWACLI_SERVE_LOCK_PATH;
    else process.env.NUWACLI_SERVE_LOCK_PATH = prevLock;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("user-resume purpose bypasses serve and runs op", async () => {
    const { withSensitiveAccess } = await import(
      "../src/core/permissions/sensitiveAccessGate.js"
    );
    const value = await withSensitiveAccess(
      {
        kind: "session-history",
        title: "local_sessions_list",
        purpose: "user-resume",
      },
      async () => 42,
    );
    expect(value).toBe(42);
  });

  it("user-cli purpose bypasses serve", async () => {
    const { withSensitiveAccess } = await import(
      "../src/core/permissions/sensitiveAccessGate.js"
    );
    const value = await withSensitiveAccess(
      {
        kind: "session-history",
        title: "local_sessions_list",
        purpose: "user-cli",
      },
      async () => "ok",
    );
    expect(value).toBe("ok");
  });

  it("agent-export without serve.lock throws CONSENT_REQUIRED", async () => {
    const { withSensitiveAccess, ConsentRequiredError } = await import(
      "../src/core/permissions/sensitiveAccessGate.js"
    );
    await expect(
      withSensitiveAccess(
        {
          kind: "session-history",
          title: "local_sessions_list",
          purpose: "agent-export",
        },
        async () => "secret",
      ),
    ).rejects.toBeInstanceOf(ConsentRequiredError);
  });
});
