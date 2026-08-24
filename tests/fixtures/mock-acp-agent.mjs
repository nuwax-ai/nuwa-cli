#!/usr/bin/env node
// Minimal scripted ACP agent speaking JSON-RPC 2.0 NDJSON over stdio.
// Used by connection.test.ts to exercise the real spawn + ACP wire path
// without depending on claude-code-acp-ts or a network call.
//
// Behavior is driven by the prompt text sent to session/prompt:
//   "trigger-permission" -> sends a session/request_permission request mid-turn
//   "trigger-hang"       -> never responds to session/prompt (simulates a stuck engine)
//   "trigger-error"      -> agent process exits non-zero immediately
//   "trigger-codex-ask"  -> emits Codex's wrapped MCP ask tool update
//   "trigger-claude-ask" -> emits Claude's JSON MCP ask tool result
//   "spawn-grandchild"   -> spawns a grandchild that ignores SIGTERM and writes
//                           its pid to $NUWA_TEST_GRANDCHILD_PID_FILE (reproduces
//                           the orphaned-grandchild defect; see engineTreeTeardown.test.ts)
//   anything else        -> streams two agent_message_chunk updates, then stops

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
let nextSessionCounter = 0;
let grandchildPid = null;

const grandchildScript = `
const fs = require("node:fs");
process.on("SIGTERM", () => {}); // ignore SIGTERM so only group SIGKILL kills us
fs.writeFileSync(process.env.NUWA_TEST_GRANDCHILD_PID_FILE, String(process.pid));
setInterval(() => {}, 1000);
`;

function spawnGrandchild() {
  const pidFile = process.env.NUWA_TEST_GRANDCHILD_PID_FILE;
  if (!pidFile || grandchildPid) return;
  const child = spawn(process.execPath, ["-e", grandchildScript], {
    env: { ...process.env, NUWA_TEST_GRANDCHILD_PID_FILE: pidFile },
    stdio: "ignore",
  });
  grandchildPid = child.pid;
}

// Standalone mode for terminateProcessTree unit tests: spawn the grandchild at
// startup instead of waiting for a prompt trigger.
if (process.env.NUWA_TEST_GRANDCHILD_ON_START === "1") {
  spawnGrandchild();
}

// stdin EOF -> reproduce R3: hard-exit without cleaning up the grandchild. The
// graceful-test variant waits NUWA_TEST_GRACEFUL_EXIT_MS then kills the
// grandchild before exiting (proves natural exit never needs group SIGTERM).
rl.on("close", () => {
  if (process.env.NUWA_TEST_HANG_ON_EOF === "1") return; // hang: teardown must kill us
  const gracefulMs = Number(process.env.NUWA_TEST_GRACEFUL_EXIT_MS || 0);
  setTimeout(() => {
    if (
      process.env.NUWA_TEST_GRACEFUL_KILL_GRANDCHILD === "1" &&
      grandchildPid
    ) {
      try {
        // The grandchild deliberately ignores SIGTERM (real-defect shape), so
        // the graceful-adapter control must use SIGKILL to clean it up itself.
        process.kill(grandchildPid, "SIGKILL");
      } catch {
        // grandchild already gone
      }
    }
    process.exit(0);
  }, gracefulMs);
});

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function notify(method, params) {
  send({ jsonrpc: "2.0", method, params });
}

async function request(method, params) {
  const id = `mock-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    const handler = (line) => {
      const msg = JSON.parse(line);
      if (msg.id === id) {
        rl.off("line", handler);
        resolve(msg.result);
      }
    };
    rl.on("line", handler);
    send({ jsonrpc: "2.0", id, method, params });
  });
}

rl.on("line", async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined || msg.method === undefined) return; // response to our own request(), handled above

  switch (msg.method) {
    case "initialize":
      respond(msg.id, {
        protocolVersion: msg.params.protocolVersion,
        agentCapabilities: { loadSession: true, promptCapabilities: {} },
      });
      break;
    case "session/new": {
      const sessionId = `mock-session-${++nextSessionCounter}`;
      respond(msg.id, { sessionId });
      break;
    }
    case "session/load":
      notify("session/update", {
        sessionId: msg.params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "(replayed history)" },
        },
      });
      respond(msg.id, { sessionId: msg.params.sessionId });
      break;
    case "session/prompt": {
      const text = JSON.stringify(msg.params.prompt);
      if (text.includes("spawn-grandchild")) {
        // Spawn the grandchild then hang (no respond) — reproduces an engine
        // parked in a long tool call while its grandchild keeps running.
        spawnGrandchild();
        break;
      }
      if (text.includes("trigger-error")) {
        process.exit(1);
      }
      if (text.includes("trigger-hang")) {
        // Intentionally never respond — simulates an engine parked mid-tool.
        // The connection's AbortSignal is what unblocks the caller.
        break;
      }
      if (text.includes("trigger-codex-ask")) {
        notify("session/update", {
          sessionId: msg.params.sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "call-codex-ask",
            title: "mcp.ask-question.nuwax_ask_question",
            status: "in_progress",
            rawInput: {
              server: "ask-question",
              tool: "nuwax_ask_question",
              arguments: {
                requestId: "ask-codex",
                sessionId: "demo",
                title: "Codex ask",
                ui: {
                  presentation: "inline",
                  title: "Codex ask",
                  fields: [{ name: "choice", title: "Choice", widget: "radio" }],
                },
              },
            },
          },
        });
        respond(msg.id, { stopReason: "end_turn" });
        break;
      }
      if (text.includes("trigger-claude-ask")) {
        const input = {
          toolName: "nuwax_ask_question",
          schemaVersion: "nuwax.mcp_ask.v2",
          requestId: "ask-claude",
          sessionId: "demo",
          title: "Claude ask",
          ui: {
            version: "nuwax.interaction.v2",
            presentation: "inline",
            title: "Claude ask",
            fields: [{ name: "choice", title: "Choice", widget: "radio" }],
          },
        };
        notify("session/update", {
          sessionId: msg.params.sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "call-claude-ask",
            status: "completed",
            _meta: {
              claudeCode: {
                toolName: "mcp__ask-question__nuwax_ask_question",
              },
            },
            rawOutput: JSON.stringify({ status: "pending", input }),
          },
        });
        respond(msg.id, { stopReason: "end_turn" });
        break;
      }
      if (text.includes("trigger-sensitive-permission")) {
        const permission = await request("session/request_permission", {
          sessionId: msg.params.sessionId,
          toolCall: {
            toolCallId: "call-sensitive",
            title: "bash",
            kind: "execute",
            rawInput: { command: "nuwa-cli context list --json" },
          },
          options: [
            { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
            { optionId: "allow-always", name: "Allow always", kind: "allow_always" },
            { optionId: "reject-once", name: "Reject", kind: "reject_once" },
          ],
        });
        notify("session/update", {
          sessionId: msg.params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: `sensitive:${permission.outcome.outcome === "selected" ? permission.outcome.optionId : "cancelled"}`,
            },
          },
        });
        respond(msg.id, { stopReason: "end_turn" });
        break;
      }
      if (text.includes("trigger-permission")) {
        const permission = await request("session/request_permission", {
          sessionId: msg.params.sessionId,
          toolCall: { toolCallId: "call-1", title: "run a command" },
          options: [
            { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
            { optionId: "allow-always", name: "Allow always", kind: "allow_always" },
            { optionId: "reject-once", name: "Reject", kind: "reject_once" },
          ],
        });
        notify("session/update", {
          sessionId: msg.params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: `decision:${permission.outcome.outcome === "selected" ? permission.outcome.optionId : "cancelled"}` },
          },
        });
        respond(msg.id, { stopReason: "end_turn" });
        break;
      }
      notify("session/update", {
        sessionId: msg.params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hello, " },
        },
      });
      notify("session/update", {
        sessionId: msg.params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "world!" },
        },
      });
      respond(msg.id, { stopReason: "end_turn" });
      break;
    }
    default:
      respond(msg.id, {});
  }
});
