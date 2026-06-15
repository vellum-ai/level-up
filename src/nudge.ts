/**
 * Builds the in-turn nudge that invites the model to render the "Level Up"
 * card itself, and detects whether a card was already rendered this turn.
 *
 * The card is a `ui_show` `work_result` surface: a compact, git-style preview
 * of the latest self-edit plus a link to the bundled Level Up app, which holds
 * the full diff history. The model already has the exact edit contents in its
 * context, so the inline nudge below lets a compliant model render the card
 * in-context. If it ends the turn without one, the `post-model-call` hook
 * appends the `ui_show` call itself ({@link ../hooks/post-model-call}), so the
 * card is shown either way; {@link alreadyRenderedCard} keeps the two paths
 * from doubling up.
 */

import type { Message } from "@vellumai/plugin-api";

import { isToolUse } from "./detect.js";
import type { PendingCapability } from "./state.js";

/** In-product route to the bundled Level Up app (the full history view). */
export const LEVEL_UP_APP_HREF = "/assistant/library/level-up";

const UI_SHOW_TOOL_NAMES: ReadonlySet<string> = new Set([
  "ui_show",
  "host_ui_show",
]);

function describeTargets(capabilities: ReadonlyArray<PendingCapability>): string {
  return capabilities
    .map(
      (cap) => `- ${cap.kind} "${cap.name}" — ${cap.change} ${cap.files.join(", ")}`,
    )
    .join("\n");
}

/**
 * Short, in-context reminder appended after the triggering tool result so
 * the model renders the card before it ends the turn. Kept terse because it
 * rides along with every batch's first capability edit.
 */
export function buildInlineNudge(
  capabilities: ReadonlyArray<PendingCapability>,
): string {
  return [
    "[level-up] You just modified your own capabilities this turn:",
    describeTargets(capabilities),
    "",
    'Before you end this turn, call the built-in `ui_show` tool once with a',
    '`work_result` surface to show the user a "Level Up" card: a compact,',
    "git-style preview of the most important change (a few diff lines, not the",
    "whole file) plus a link to the full history. Use the exact before/after",
    `contents from your edits above, and include a link item to "${LEVEL_UP_APP_HREF}".`,
    "Do not describe the card in prose.",
  ].join("\n");
}

/**
 * Did the model already render a `ui_show` card in the window after the last
 * genuine user prompt? Used to avoid forcing a redundant follow-up turn when
 * the model complied with the inline nudge on its own.
 *
 * The boundary is the last genuine user prompt. Two kinds of `user`-role
 * messages are *not* prompts and must be skipped: this plugin's own injected
 * nudges, and tool-result messages (the host carries each `tool_result` in a
 * `user`-role message). A `ui_show` call is always followed by its
 * tool-result message, so skipping those is what lets us see the `ui_show`
 * behind it.
 */
export function alreadyRenderedCard(messages: ReadonlyArray<Message>): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message === undefined) {
      continue;
    }
    if (
      message.role === "user" &&
      !isLevelUpInjection(message) &&
      !isToolResultMessage(message)
    ) {
      return false;
    }
    for (const block of message.content) {
      if (isToolUse(block) && UI_SHOW_TOOL_NAMES.has(block.name)) {
        return true;
      }
    }
  }
  return false;
}

/** A user message this plugin injected at a prior turn boundary. */
function isLevelUpInjection(message: Message): boolean {
  return message.content.some(
    (block) =>
      block.type === "text" &&
      typeof (block as { text?: unknown }).text === "string" &&
      (block as { text: string }).text.startsWith("[level-up]"),
  );
}

/** A synthetic `user`-role message carrying tool output, not a real prompt. */
function isToolResultMessage(message: Message): boolean {
  return message.content.some((block) => block.type === "tool_result");
}
