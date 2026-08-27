import { t } from "../../util/i18n/index.js";
import pc from "picocolors";
import {
  AGENT_METHODS,
  type ClientContext,
} from "@agentclientprotocol/sdk";
import {
  applySessionMode as applyModeViaChannel,
  type SessionModeChannel,
} from "@nuwax-ai/agent-kit";
import type { SessionHandle } from "./sessionHandle.js";

/** Tried in order when --yolo is set without an explicit --mode; first one the engine actually offers wins. */
const YOLO_MODE_PREFERENCE = [
  "bypassPermissions",
  "dontAsk",
  "full-access",
  "yolo",
];

/** Adapt the raw ClientContext request API onto agent-kit's channel shape. */
export function sessionModeChannelFor(ctx: ClientContext): SessionModeChannel {
  return {
    setSessionMode: (params) =>
      ctx.request(AGENT_METHODS.session_set_mode, params),
    setSessionConfigOption: (params) =>
      ctx
        .request(AGENT_METHODS.session_set_config_option, params)
        .then(() => undefined),
  };
}

/**
 * Applies a session mode (engine-level "don't ask me" setting) on top of
 * whatever the per-call permission policy already does. This is a
 * best-effort optimization — if the mode can't be set, decidePermission()
 * remains the source of truth for individual tool-call approvals.
 *
 * The apply itself (set_mode with mode-config-option fallback and
 * method-not-found tolerance) is shared with nuwaclaw via agent-kit.
 */
export async function applySessionMode(
  ctx: ClientContext,
  session: Pick<SessionHandle, "sessionId" | "modes">,
  requestedModeId: string | undefined,
  yolo: boolean,
): Promise<string | undefined> {
  const available = session.modes?.availableModes?.map((m) => m.id) ?? [];

  let modeId = requestedModeId;
  if (!modeId && yolo) {
    modeId = YOLO_MODE_PREFERENCE.find((id) => available.includes(id));
  }
  if (!modeId) return undefined;

  if (available.length > 0 && !available.includes(modeId)) {
    console.error(
      pc.yellow(
        t("sessionMode.unsupported", {
          mode: modeId,
          available: available.join(", "),
        }),
      ),
    );
    return undefined;
  }

  const outcome = await applyModeViaChannel({
    sessionId: session.sessionId,
    modeId,
    connection: sessionModeChannelFor(ctx),
  });
  if (outcome.status === "applied") {
    // Return the applied id so callers can mirror it into local state
    // (SetSessionModeResponse carries no new state).
    return modeId;
  }
  console.error(
    pc.yellow(
      t("sessionMode.setFailed", {
        mode: modeId,
        msg: outcome.reason,
      }),
    ),
  );
  return undefined;
}
