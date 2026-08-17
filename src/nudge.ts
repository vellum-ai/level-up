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

/**
 * In-product route to a skill's page opened on its History tab, where the
 * host shows the skill's recent revisions from workspace git. The skill id is
 * its directory name, percent-encoded so it stays one path segment for the
 * host's `skills/:skillId` route (the same shape the host's own links use).
 */
export function skillHistoryHref(name: string): string {
  return `/assistant/skills/${encodeURIComponent(name)}?tab=history`;
}

/**
 * Where the card should send the user for the full history of one changed
 * capability: a skill that still exists links to its own History tab; a
 * plugin, or a skill that was deleted (its page would be "not found"), links
 * to the Level Up app, which holds every recorded self-edit.
 */
export function capabilityHistoryHref(cap: PendingCapability): string {
  return cap.kind === "skill" && cap.change !== "deleted"
    ? skillHistoryHref(cap.name)
    : LEVEL_UP_APP_HREF;
}

const UI_SHOW_TOOL_NAMES: ReadonlySet<string> = new Set([
  "ui_show",
  "host_ui_show",
]);

function describeTargets(capabilities: ReadonlyArray<PendingCapability>): string {
  return capabilities
    .map(
      (cap) =>
        `- ${cap.kind} "${cap.name}" — ${cap.change} ${cap.files.join(", ")} (history: ${capabilityHistoryHref(cap)})`,
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
    "contents from your edits above, and include one link item per capability",
    "pointing at the history href listed for it above (a skill's own History",
    "tab, or the Level Up app).",
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
