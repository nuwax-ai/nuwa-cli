import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmpHome: string;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: () => tmpHome };
});

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-engineHome-"));
  vi.resetModules();
});
afterEach(() => {
  delete process.env.NUWACLI_ISOLATE_ENGINES;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("isEngineIsolationEnabled", () => {
  it("defaults to ON when unset", async () => {
    delete process.env.NUWACLI_ISOLATE_ENGINES;
    const { isEngineIsolationEnabled } = await import(
      "../src/core/env/engineHome.js"
    );
    expect(isEngineIsolationEnabled()).toBe(true);
  });

  it.each(["0", "false", "no", "off", "FALSE", "Off"])(
    "is OFF for %j",
    async (v) => {
      process.env.NUWACLI_ISOLATE_ENGINES = v;
      const { isEngineIsolationEnabled } = await import(
        "../src/core/env/engineHome.js"
      );
      expect(isEngineIsolationEnabled()).toBe(false);
    },
  );

  it("is ON for an explicit '1'", async () => {
    process.env.NUWACLI_ISOLATE_ENGINES = "1";
    const { isEngineIsolationEnabled } = await import(
      "../src/core/env/engineHome.js"
    );
    expect(isEngineIsolationEnabled()).toBe(true);
  });
});

describe("home resolvers", () => {
  it("ON: codex/claude homes live under the nuwa-cli home", async () => {
    delete process.env.NUWACLI_ISOLATE_ENGINES;
    const m = await import("../src/core/env/engineHome.js");
    expect(m.codexHome()).toBe(
      path.join(tmpHome, ".nuwa-cli", "codex-home"),
    );
    expect(m.codexSessionsDir()).toBe(
      path.join(tmpHome, ".nuwa-cli", "codex-home", "sessions"),
    );
    expect(m.codexAuthFile()).toBe(
      path.join(tmpHome, ".nuwa-cli", "codex-home", "auth.json"),
    );
    expect(m.codexConfigToml()).toBe(
      path.join(tmpHome, ".nuwa-cli", "codex-home", "config.toml"),
    );
    expect(m.claudeConfigDir()).toBe(
      path.join(tmpHome, ".nuwa-cli", "claude-config"),
    );
    expect(m.claudeProjectsDir()).toBe(
      path.join(tmpHome, ".nuwa-cli", "claude-config", "projects"),
    );
    expect(m.claudeSettingsFile()).toBe(
      path.join(tmpHome, ".nuwa-cli", "claude-config", "settings.json"),
    );
  });

  it("OFF: codex/claude homes are the real ~/.codex / ~/.claude", async () => {
    process.env.NUWACLI_ISOLATE_ENGINES = "0";
    const m = await import("../src/core/env/engineHome.js");
    expect(m.codexHome()).toBe(path.join(tmpHome, ".codex"));
    expect(m.codexSessionsDir()).toBe(path.join(tmpHome, ".codex", "sessions"));
    expect(m.claudeConfigDir()).toBe(path.join(tmpHome, ".claude"));
    expect(m.claudeProjectsDir()).toBe(
      path.join(tmpHome, ".claude", "projects"),
    );
  });
});

describe("ensureIsolatedEngineHomes", () => {
  it("ON: creates codex sessions + claude projects dirs", async () => {
    delete process.env.NUWACLI_ISOLATE_ENGINES;
    const { ensureIsolatedEngineHomes } = await import(
      "../src/core/env/engineHome.js"
    );
    ensureIsolatedEngineHomes();
    expect(
      fs.existsSync(
        path.join(tmpHome, ".nuwa-cli", "codex-home", "sessions"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(tmpHome, ".nuwa-cli", "claude-config", "projects"),
      ),
    ).toBe(true);
  });

  it("OFF: creates nothing under .nuwa-cli", async () => {
    process.env.NUWACLI_ISOLATE_ENGINES = "0";
    const { ensureIsolatedEngineHomes } = await import(
      "../src/core/env/engineHome.js"
    );
    ensureIsolatedEngineHomes();
    expect(fs.existsSync(path.join(tmpHome, ".nuwa-cli"))).toBe(false);
  });

  it("engine filter only ensures that engine's dirs", async () => {
    delete process.env.NUWACLI_ISOLATE_ENGINES;
    const { ensureIsolatedEngineHomes } = await import(
      "../src/core/env/engineHome.js"
    );
    ensureIsolatedEngineHomes("codex");
    expect(
      fs.existsSync(
        path.join(tmpHome, ".nuwa-cli", "codex-home", "sessions"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(tmpHome, ".nuwa-cli", "claude-config")),
    ).toBe(false);
  });
});
