/**
 * `stop` hook — the deterministic backstop that guarantees a "Level Up"
 * card is shown after the assistant edits its own skills or plugins.
 *
 * Fires at the turn boundary, once the model yields a response with no tool
 * calls. If the turn touched capabilities and the model has not already
 * rendered a `ui_show` card on its own, this appends a fully-specified nudge
 * and forces one more loop iteration (`decision = "continue"`) so the card is
 * rendered after the fact. Either way the batch is drained so the next stop
 * does not re-trigger.
 *
 * Convention: default export is the function the harness invokes.
 */

import type { StopContext } from "@vellumai/plugin-api";

import { alreadyRenderedCard, buildStopNudgeMessage } from "../src/nudge.js";
import {
  clearPendingCapabilities,
  getPendingCapabilities,
} from "../src/state.js";

export default async function stop(ctx: StopContext): Promise<void> {
  const pending = getPendingCapabilities(ctx.conversationId);
  if (pending.length === 0) {
    return;
  }

  // Drain regardless of outcome: this is a best-effort, one-shot summary and
  // we must not loop on it across stop boundaries.
  clearPendingCapabilities(ctx.conversationId);

  if (alreadyRenderedCard(ctx.messages)) {
    ctx.logger.info(
      {
        plugin: "level-up",
        conversationId: ctx.conversationId,
        capabilities: pending.length,
      },
      "level-up card already rendered by the model; nothing to do",
    );
    return;
  }

  ctx.messages.push(buildStopNudgeMessage(pending));
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
