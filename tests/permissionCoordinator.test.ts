import { describe, it, expect } from "vitest";
import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import { PermissionCoordinator } from "../src/core/permissions/coordinator.js";
import { sessionHistoryAccessClassifier } from "../src/core/permissions/classifiers/sessionHistoryAccess.js";

function makeRequest(
  overrides: Partial<RequestPermissionRequest["toolCall"]> & {
    title?: string;
    rawInput?: unknown;
  } = {},
): RequestPermissionRequest {
  return {
    sessionId: "sess-1",
    toolCall: {
      toolCallId: "tool-1",
      kind: "execute",
      title: overrides.title ?? "bash",
      rawInput: overrides.rawInput ?? { command: "ls" },
      ...overrides,
    },
    options: [
      { optionId: "allow_always", name: "Always", kind: "allow_always" },
      { optionId: "allow_once", name: "Once", kind: "allow_once" },
      { optionId: "reject_once", name: "Reject", kind: "reject_once" },
    ],
  };
}

describe("PermissionCoordinator", () => {
  it("yolo auto-allows ordinary tool calls", () => {
    const c = new PermissionCoordinator();
    const d = c.evaluate(makeRequest(), "yolo", "app-1");
    expect(d).toMatchObject({
      kind: "select",
      optionId: "allow_always",
      reason: "auto_allow",
    });
  });

  it("yolo still forces ask for session-history bash", () => {
    const c = new PermissionCoordinator();
    const d = c.evaluate(
      makeRequest({
        rawInput: { command: "nuwa-cli context list --json" },
      }),
      "yolo",
      "app-1",
    );
    expect(d).toMatchObject({
      kind: "ask",
      reason: "sensitive_classifier",
      classifierId: "session-history",
    });
  });

  it("yolo forces ask for ~/.claude/projects paths", () => {
    const c = new PermissionCoordinator();
    const d = c.evaluate(
      makeRequest({
        kind: "read",
        title: "Read",
        rawInput: { path: "/Users/x/.claude/projects/foo/bar.jsonl" },
      }),
      "yolo",
    );
    expect(d.kind).toBe("ask");
  });

  it("ask mode asks for ordinary tools", () => {
    const c = new PermissionCoordinator();
    const d = c.evaluate(makeRequest(), "ask", "app-1");
    expect(d).toMatchObject({ kind: "ask", reason: "approve_ask" });
  });

  it("deny rejects sensitive and ordinary tools", () => {
    const c = new PermissionCoordinator();
    expect(
      c.evaluate(
        makeRequest({
          rawInput: { command: "nuwa-cli sessions --json" },
        }),
        "deny",
      ),
    ).toMatchObject({ kind: "select", optionId: "reject_once" });
    expect(c.evaluate(makeRequest(), "deny")).toMatchObject({
      kind: "select",
      optionId: "reject_once",
    });
  });

  it("rememberAllowAlways skips further asks for that classifier", () => {
    const c = new PermissionCoordinator();
    c.rememberAllowAlways("app-1", "session-history");
    const d = c.evaluate(
      makeRequest({
        rawInput: { command: "nuwa-cli context digest --ref claude:abc" },
      }),
      "yolo",
      "app-1",
    );
    expect(d).toMatchObject({
      kind: "select",
      reason: "cached_allow_always",
    });
  });

  it("sessionHistoryAccessClassifier matches synthetic titles", () => {
    expect(
      sessionHistoryAccessClassifier.match(
        makeRequest({ title: "local_sessions_list", kind: "read" }),
      ),
    ).toBe(true);
  });

  it("matches node …/dist/cli.js context and pnpm exec nuwa-cli", () => {
    expect(
      sessionHistoryAccessClassifier.match(
        makeRequest({
          rawInput: {
            command: "node /Users/x/nuwa-cli/dist/cli.js context list --json",
          },
        }),
      ),
    ).toBe(true);
    expect(
      sessionHistoryAccessClassifier.match(
        makeRequest({
          rawInput: { command: "pnpm exec nuwa-cli sessions --json" },
        }),
      ),
    ).toBe(true);
    expect(
      sessionHistoryAccessClassifier.match(
        makeRequest({
          rawInput: { command: "pnpm run dev:cli -- context digest --ref claude:x" },
        }),
      ),
    ).toBe(true);
  });
});
