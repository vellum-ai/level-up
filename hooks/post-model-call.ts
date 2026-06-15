/**
 * `post-model-call` hook — the deterministic backstop that shows a "Level Up"
 * card after the assistant edits its own skills or plugins.
 *
 * When a turn ends without the model having rendered the card itself, this
 * hook appends a synthetic `ui_show` tool-use block to the finalized assistant
 * reply ({@link PostModelCallContext.content}). The host derives the turn's
 * executable tool calls from that finalized content, so the appended call runs
 * through the normal executor — as if the model had called `ui_show` — and the
 * card streams in as a surface after any prose the model already produced.
 * Surfaces live on a separate channel from text, so this never retracts a
 * reply the user is already reading (which is why a `decision: "continue"`
 * re-prompt was the wrong tool: it discards the streamed turn).
 *
 * The hook fires at every model-call outcome, so it self-gates hard:
 *
 *   - Skips provider rejections (`ctx.error` present) — not our concern.
 *   - Skips every call site except the user-facing `mainAgent` reply, so
 *     background, subagent, and compaction calls are never touched.
 *   - Skips tool-bearing replies: the loop runs those tools and the pending
 *     batch is retained for the eventual no-tool reply. (A model that renders
 *     the card itself does so via the `ui_show` tool — that turn is
 *     tool-bearing and passes through here untouched.)
 *   - Skips when no card-worthy edit is pending, or when a card was already
 *     rendered since the last user prompt. The latter is also what bounds
 *     re-injection: once this hook's `ui_show` lands in history, the follow-up
 *     turn it triggers sees it via {@link alreadyRenderedCard} and stops.
 *
 * Convention: default export is the function the harness invokes.
 */

import type { PostModelCallContext } from "@vellumai/plugin-api";

import { buildLevelUpToolUse } from "../src/card.js";
import { hasToolUse } from "../src/detect.js";
import { alreadyRenderedCard } from "../src/nudge.js";
import {
  getPendingCapabilities,
  hasPendingCapabilities,
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

  const pending = getPendingCapabilities(ctx.conversationId);
  ctx.content = [...ctx.content, buildLevelUpToolUse(pending)];

  ctx.logger.info(
    {
      plugin: "level-up",
      conversationId: ctx.conversationId,
      capabilities: pending.length,
    },
    "level-up appended a ui_show card to the finalized reply",
  );
}
