/**
 * `stop` hook — flushes this plugin's ephemeral per-turn state at the
 * terminal stop boundary.
 *
 * `StopContext` is terminal: its `messages` are read-only and it carries no
 * continue capability, so the loop will not run again this turn. The card is
 * shown from the `post-model-call` hook (which appends a `ui_show` tool call
 * to the finalized reply). This hook's sole job is to drop the conversation's
 * pending batch so the next turn starts clean.
 *
 * Convention: default export is the function the harness invokes.
 */

import type { StopContext } from "@vellumai/plugin-api";

import { clearPendingCapabilities } from "../src/state.js";

export default async function stop(ctx: StopContext): Promise<void> {
  clearPendingCapabilities(ctx.conversationId);
}
