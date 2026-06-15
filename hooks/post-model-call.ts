/**
 * `post-model-call` hook — the deterministic backstop that guarantees a
 * "Level Up" card is shown after the assistant edits its own skills or
 * plugins.
 *
 * This is the only hook the agent loop lets continue the turn: setting
 * {@link PostModelCallContext.decision} to `"continue"` re-queries the model
 * with the (mutated) history. The hook fires at every model-call outcome, so
 * it self-gates hard before acting:
 *
 *   - Skips provider rejections (`ctx.error` present) — not our concern.
 *   - Skips every call site except the user-facing `mainAgent` reply, so
 *     background, subagent, and compaction calls are never re-queried.
 *   - Skips tool-bearing replies: the loop runs the tools and ignores the
 *     decision, and the pending batch is retained for the eventual no-tool
 *     reply. (A model that renders the card does so via the `ui_show`
 *     tool — that turn is tool-bearing and passes through here untouched.)
 *
 * When a no-tool reply lands with capabilities still pending and no card
 * rendered, it injects a fully-specified nudge and forces exactly one more
 * loop iteration. The one-shot mark guarantees a non-compliant model can
 * never spin the loop; the `stop` hook clears both marks at the boundary.
 *
 * Convention: default export is the function the harness invokes.
 */

import type { PostModelCallContext } from "@vellumai/plugin-api";

import { hasToolUse } from "../src/detect.js";
import { alreadyRenderedCard, buildForcedRenderMessage } from "../src/nudge.js";
import {
  getPendingCapabilities,
  hasPendingCapabilities,
  markForcedRender,
} from "../src/state.js";

export default async function postModelCall(
  ctx: PostModelCallContext,
): Promise<void> {
  if (ctx.error !== undefined) {
    return;
  }
  if (ctx.callSite !== "mainAgent") {
    return;
  }
  if (hasToolUse(ctx.content)) {
    return;
  }

  if (!hasPendingCapabilities(ctx.conversationId)) {
    return;
  }
  if (alreadyRenderedCard(ctx.messages)) {
    return;
  }
  if (!markForcedRender(ctx.conversationId)) {
    return;
  }

  const pending = getPendingCapabilities(ctx.conversationId);
  ctx.messages.push(buildForcedRenderMessage(pending));
  ctx.decision = "continue";

  ctx.logger.info(
    {
      plugin: "level-up",
      conversationId: ctx.conversationId,
      capabilities: pending.length,
    },
    "level-up forcing a follow-up turn to render the card",
  );
}
