/**
 * Builds the model-facing instructions that drive the "Level Up" card, and
 * detects whether the model already rendered one this turn.
 *
 * This plugin contributes no UI surface of its own. Instead it asks the
 * model to call the host's built-in `ui_show` tool with a `work_result`
 * surface whose `diff` sections carry the before/after of each edited
 * capability. The model already has the exact edit contents in its context,
 * so it can populate faithful diffs; the nudges below just guarantee the
 * card is rendered, once, after the fact.
 */

import type { Message } from "@vellumai/plugin-api";

import { isToolUse } from "./detect.js";
import type { PendingCapability } from "./state.js";

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
    '`work_result` surface to show the user a first-class "Level Up" card with',
    "the before/after diff of each change. Use the exact prior and new file",
    "contents from your edits above. Do not describe the card in prose.",
  ].join("\n");
}

/**
 * Stronger, fully-specified instruction appended at the stop boundary when
 * the model ended its turn without rendering the card. Carries a concrete
 * `ui_show` example so the follow-up turn can render deterministically.
 */
export function buildStopNudgeMessage(
  capabilities: ReadonlyArray<PendingCapability>,
): Message {
  const sections = capabilities
    .map((cap) => {
      const diffs = cap.files
        .map(
          (file) =>
            `        { "label": ${JSON.stringify(file)}, "before": "<exact prior contents>", "after": "<exact new contents>" }`,
        )
        .join(",\n");
      return [
        "      {",
        `        "title": ${JSON.stringify(`${cap.name} (${cap.kind})`)},`,
        '        "type": "diff",',
        '        "description": "<what changed in this capability and why>",',
        '        "diffs": [',
        diffs,
        "        ]",
        "      }",
      ].join("\n");
    })
    .join(",\n");

  const text = [
    "[level-up] This turn you improved your own capabilities:",
    describeTargets(capabilities),
    "",
    'Before finishing, show the user a single first-class "Level Up" card by',
    "calling the `ui_show` tool exactly once. Populate each diff with the real",
    "before/after contents from your edits above:",
    "",
    "ui_show({",
    '  "surface_type": "work_result",',
    '  "title": "Level up",',
    '  "display": "inline",',
    '  "data": {',
    '    "eyebrow": "Self-improvement",',
    '    "status": "completed",',
    '    "summary": "<one sentence: what you learned and why you changed it>",',
    '    "sections": [',
    sections,
    "    ]",
    "  }",
    "})",
    "",
    "Render the card, then end your turn. Do not narrate it in prose.",
  ].join("\n");

  return { role: "user", content: [{ type: "text", text }] };
}

/**
 * Did the model already render a `ui_show` card in the window after the last
 * genuine user prompt? Used to avoid forcing a redundant follow-up turn when
 * the model complied with the inline nudge on its own. The boundary is the
 * last user message that this plugin did not itself inject.
 */
export function alreadyRenderedCard(messages: ReadonlyArray<Message>): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message === undefined) {
      continue;
    }
    if (message.role === "user" && !isLevelUpInjection(message)) {
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

/** A user message this plugin injected at a prior stop boundary. */
function isLevelUpInjection(message: Message): boolean {
  return message.content.some(
    (block) =>
      block.type === "text" &&
      typeof (block as { text?: unknown }).text === "string" &&
      (block as { text: string }).text.startsWith("[level-up]"),
  );
}
