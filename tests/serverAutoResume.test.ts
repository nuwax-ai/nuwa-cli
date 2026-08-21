import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
} from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { startServeHttp } from "../src/core/serve/server.js";
import type { LocalSessionSummary } from "../src/core/sessions/discovery.js";

// Engine registry: resolve() throws so every chat surfaces as 502. The
// auto-resume branch chooses resumeSession vs startSession *before* the engine
// is contacted, so a failing engine doesn't obscure which path was taken.
const engineMocks = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("../src/core/engines/registry.js", () => ({
  getEngine: (id: string) => {
    engineMocks.ids.push(id);
    return {
      resolve: async () => {
        throw new Error("ACP runtime unavailable for test");
      },
    };
  },
}));

// Control the local-session history without touching the real disk: the
// auto-resume lookup reads this list. The cwd filter still runs in server.ts,
// so a row whose cwd != the request's workspace is correctly ignored.
const sessionMocks = vi.hoisted(() => ({ local: [] as LocalSessionSummary[] }));
vi.mock("../src/core/sessions/discovery.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/core/sessions/discovery.js")>();
  return { ...actual, listLocalSessions: async () => sessionMocks.local };
});

describe("serve /computer/chat auto-resume by projectKey", () => {
  let handle: ReturnType<typeof startServeHttp>;
  const serverCwd = path.join(os.tmpdir(), "nuwa-cli-autoresume-ws");
  const workspaceUser = "autoresume-user";
  const agentWorkDir = "autoresume-agent";
  // cwdResult.cwd is derived as `<serverCwd>/<userSegment>/<projectSegment>`;
  // userSegment/workspaceSegment sanitize to themselves here.
  const workspacePath = path.join(serverCwd, workspaceUser, agentWorkDir);

  beforeAll(async () => {
    process.env.NUWACLI_SERVE_LOCK_PATH = path.join(
      os.tmpdir(),
      "nuwa-cli-autoresume-test.lock",
    );
    process.env.NUWACLI_DEBUG_LOG_PATH = path.join(
      os.tmpdir(),
      "nuwa-cli-autoresume-test-debug.log",
    );
    fs.mkdirSync(serverCwd, { recursive: true });
    handle = startServeHttp({
      port: 0,
      host: "127.0.0.1",
      engine: "codex",
      cwd: serverCwd,
      permissionMode: "yolo",
    });
    await new Promise<void>((resolve) =>
      handle.server.once("listening", resolve),
    );
  });

  afterAll(async () => {
    await handle.stop();
    fs.rmSync(serverCwd, { recursive: true, force: true });
    if (process.env.NUWACLI_DEBUG_LOG_PATH) {
      fs.rmSync(process.env.NUWACLI_DEBUG_LOG_PATH, { force: true });
    }
    delete process.env.NUWACLI_SERVE_LOCK_PATH;
    delete process.env.NUWACLI_DEBUG_LOG_PATH;
  });

  function url(pathname: string): string {
    const address = handle.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return `http://127.0.0.1:${port}${pathname}`;
  }

  function historyRow(cwd: string): LocalSessionSummary {
    return {
      engine: "codex",
      sessionId: "hist-session-1",
      cwd,
      updatedAt: "2026-08-02T07:00:00.000Z",
      title: "previous turn",
      filePath: "/tmp/hist-session-1.jsonl",
    };
  }

  function postChat(prompt: string, extra?: Record<string, unknown>) {
    return fetch(url("/computer/chat"), {
      method: "POST",
      headers: {
        "X-Nuwax-Internal-Secret": handle.secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        user_id: workspaceUser,
        agent_work_dir: agentWorkDir,
        ...extra,
      }),
    });
  }

  it("auto-resumes the most recent local session matching cwd when no session_id is sent", async () => {
    sessionMocks.local = [historyRow(workspacePath)];
    const resumeSpy = vi.spyOn(handle.hub, "resumeSession");
    const startSpy = vi.spyOn(handle.hub, "startSession");

    const res = await fetch(url("/computer/chat"), {
      method: "POST",
      headers: {
        "X-Nuwax-Internal-Secret": handle.secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "continue",
        user_id: workspaceUser,
        agent_work_dir: agentWorkDir,
      }),
    });

    // Engine resolve is mocked to throw → 502, but the auto-resume branch
    // chose resumeSession before the engine was contacted.
    expect(res.status).toBe(502);
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).not.toHaveBeenCalled();
    // resumeSession(engineId, summary, metadata, runtime): summary.cwd must be
    // the historical session's cwd (session/load contract — caller cwd ignored).
    expect(resumeSpy.mock.calls[0][1].cwd).toBe(workspacePath);

    resumeSpy.mockRestore();
    startSpy.mockRestore();
  });

  it("falls back to startSession when no local session matches cwd", async () => {
    sessionMocks.local = [];
    const resumeSpy = vi.spyOn(handle.hub, "resumeSession");
    const startSpy = vi.spyOn(handle.hub, "startSession");

    const res = await fetch(url("/computer/chat"), {
      method: "POST",
      headers: {
        "X-Nuwax-Internal-Secret": handle.secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "fresh start",
        user_id: workspaceUser,
        agent_work_dir: agentWorkDir,
      }),
    });

    expect(res.status).toBe(502);
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(resumeSpy).not.toHaveBeenCalled();

    resumeSpy.mockRestore();
    startSpy.mockRestore();
  });

  it("does not auto-resume when a stale session_id is sent (preserves logical-session restore)", async () => {
    // A stale session_id (not in memory) must still go through startSession
    // with the id preserved as requestedSessionId — NOT be hijacked by
    // auto-resume. Auto-resume only fires when no session_id is sent at all.
    sessionMocks.local = [historyRow(workspacePath)];
    const resumeSpy = vi.spyOn(handle.hub, "resumeSession");
    const startSpy = vi.spyOn(handle.hub, "startSession");

    const res = await postChat("continue after restart", {
      session_id: "276a9b1c-3d89-4081-8981-b0d5b5a6afc4",
    });

    expect(res.status).toBe(502);
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(resumeSpy).not.toHaveBeenCalled();
    // startSession(engineId, cwd, metadata, runtime, requestedSessionId):
    // the stale id is preserved as the public session id.
    expect(startSpy.mock.calls[0][4]).toBe(
      "276a9b1c-3d89-4081-8981-b0d5b5a6afc4",
    );

    resumeSpy.mockRestore();
    startSpy.mockRestore();
  });

  it("does not auto-resume when the codex session's developer prompt differs from the request's system_prompt", async () => {
    // codex freezes thread instructions at thread/start; a resume cannot
    // swap them (developerInstructions on thread/resume is ignored). A
    // changed system_prompt must therefore start a fresh session instead
    // of silently resuming with the old persona.
    const row = { ...historyRow(workspacePath), developerPrompt: "old persona" };
    sessionMocks.local = [row];
    const resumeSpy = vi.spyOn(handle.hub, "resumeSession");
    const startSpy = vi.spyOn(handle.hub, "startSession");

    const res = await postChat("who are you", {
      system_prompt: "new persona",
    });

    expect(res.status).toBe(502);
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(resumeSpy).not.toHaveBeenCalled();
    // The fresh session must carry the new prompt into its runtime config.
    expect(startSpy.mock.calls[0][3].systemPrompt).toBe("new persona");

    resumeSpy.mockRestore();
    startSpy.mockRestore();
  });

  it("still auto-resumes when the developer prompt matches the request's system_prompt", async () => {
    const row = { ...historyRow(workspacePath), developerPrompt: "same persona" };
    sessionMocks.local = [row];
    const resumeSpy = vi.spyOn(handle.hub, "resumeSession");
    const startSpy = vi.spyOn(handle.hub, "startSession");

    const res = await postChat("continue", {
      system_prompt: "same persona",
    });

    expect(res.status).toBe(502);
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).not.toHaveBeenCalled();

    resumeSpy.mockRestore();
    startSpy.mockRestore();
  });

  it("still auto-resumes with a system_prompt when history lacks a recorded developer prompt", async () => {
    // Sessions created without a prompt (or by older builds) have no
    // developerPrompt — resume stays the default behavior.
    sessionMocks.local = [historyRow(workspacePath)];
    const resumeSpy = vi.spyOn(handle.hub, "resumeSession");
    const startSpy = vi.spyOn(handle.hub, "startSession");

    const res = await postChat("continue", {
      system_prompt: "any persona",
    });

    expect(res.status).toBe(502);
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).not.toHaveBeenCalled();

    resumeSpy.mockRestore();
    startSpy.mockRestore();
  });
});
