import { afterEach, describe, expect, it, vi } from "vitest";
import {
  infoCommand,
  type InfoDeps,
  type InfoUpdateHint,
} from "../src/commands/info.js";
import type { LocalSessionSummary } from "../src/core/sessions/discovery.js";
import { ConsentDeniedError } from "../src/core/permissions/sensitiveAccessGate.js";

function session(
  overrides: Partial<LocalSessionSummary> = {},
): LocalSessionSummary {
  return {
    engine: "claude",
    sessionId: "sess-1",
    cwd: "/tmp/proj",
    updatedAt: "2026-08-26T12:00:00.000Z",
    title: "demo session",
    filePath: "/tmp/sess-1.jsonl",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<InfoDeps> = {}): InfoDeps {
  return {
    readCredentials: () => ({
      domain: "example.com",
      username: "alice",
      computerName: "mac-1",
      configKey: "ck-secret",
      savedKey: "sk-secret",
      lanproxyPath: "/opt/lanproxy",
      accounts: {},
    }),
    listAccounts: () => [
      {
        key: "example.com_alice",
        account: {
          domain: "example.com",
          username: "alice",
          savedKey: "sk-secret",
        },
        current: true,
      },
    ],
    printRuntime: vi.fn(async () => {
      console.log("runtime-ok");
    }),
    listSessions: vi.fn(async () => [session()]),
    checkUpdate: vi.fn(
      async (): Promise<InfoUpdateHint | null> => ({
        current: "0.2.8",
        remote: "0.2.8",
        canUpgrade: false,
        channel: "latest",
      }),
    ),
    homeDir: () => "/tmp/fake-nuwa-home",
    lang: () => "en",
    version: "0.2.8",
    ...overrides,
  };
}

describe("infoCommand", () => {
  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it("prints redacted config, runtime, sessions, and update without secret values", async () => {
    const deps = makeDeps();
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });

    await infoCommand({}, deps);

    const out = logs.join("\n");
    expect(out).toMatch(/0\.2\.8/);
    expect(out).toMatch(/example\.com/);
    expect(out).toMatch(/alice/);
    expect(out).toMatch(/mac-1/);
    expect(out).toMatch(/\/tmp\/fake-nuwa-home/);
    expect(out).toMatch(/runtime-ok/);
    expect(out).toMatch(/demo session/);
    expect(out).toMatch(/sess-1/);
    expect(out).toMatch(/sessions summary/);
    expect(out).toMatch(/Up to date|已是最新/);
    // Secrets must never appear in plain text.
    expect(out).not.toContain("ck-secret");
    expect(out).not.toContain("sk-secret");
    expect(deps.listSessions).toHaveBeenCalledWith(10);
    expect(deps.checkUpdate).toHaveBeenCalledOnce();
  });

  it("honors --limit / --no-sessions / --no-update-check", async () => {
    const deps = makeDeps();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await infoCommand(
      { limit: 3, noSessions: true, noUpdateCheck: true },
      deps,
    );

    expect(deps.listSessions).not.toHaveBeenCalled();
    expect(deps.checkUpdate).not.toHaveBeenCalled();
  });

  it("hints when an update is available", async () => {
    const deps = makeDeps({
      checkUpdate: vi.fn(async () => ({
        current: "0.2.8",
        remote: "0.2.9",
        canUpgrade: true,
        channel: "latest",
      })),
    });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });

    await infoCommand({ noSessions: true }, deps);

    const out = logs.join("\n");
    expect(out).toMatch(/0\.2\.8.*0\.2\.9|0\.2\.8 → 0\.2\.9/);
    expect(out).toMatch(/nuwa-cli update/);
  });

  it("sets exitCode when session consent is denied", async () => {
    const deps = makeDeps({
      listSessions: vi.fn(async () => {
        throw new ConsentDeniedError("denied");
      }),
      checkUpdate: vi.fn(async () => null),
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await infoCommand({ noUpdateCheck: true }, deps);

    expect(process.exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalled();
  });
});
