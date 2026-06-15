/**
 * `stop` hook — flushes this plugin's ephemeral per-turn state at the
 * terminal stop boundary.
 *
 * `StopContext` is terminal: its `messages` are read-only and it carries no
 * continue capability, so the loop will not run again this turn. The forced
 * "Level Up" render therefore lives in the `post-model-call` hook (the only
 * place the loop honors a `continue`). This hook's sole job is to drop the
 * conversation's pending batch and one-shot forced-render mark so the next
 * turn starts clean.
 *
 * Convention: default export is the function the harness invokes.
 */

import type { StopContext } from "@vellumai/plugin-api";

import {
  clearForcedRender,
  clearPendingCapabilities,
} from "../src/state.js";

export default async function stop(ctx: StopContext): Promise<void> {
  clearPendingCapabilities(ctx.conversationId);
  clearForcedRender(ctx.conversationId);
}
