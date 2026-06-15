/**
 * `post-tool-use` hook — detects when the assistant changed one of its own
 * skills or plugins, records it durably, and accumulates it into a per-turn
 * batch. A change is either a filesystem edit under `skills/…`/`plugins/…` or
 * a call to a managed-skill authoring tool (`scaffold_managed_skill` /
 * `delete_managed_skill`).
 *
 * The hook fires once per tool result, before the result reaches the
 * provider. It does two things:
 *
 * 1. Appends the edit (with its diff text, when the tool surfaces one) to the
 *    durable history log the bundled Level Up app reads. This is the source
 *    of truth and is captured regardless of whether the model renders a card.
 * 2. Records the edit in ephemeral per-turn state and, the first time a batch
 *    opens for a conversation, sets an `additionalContext` nudge (model-only)
 *    asking the model to render a compact "Level Up" preview with `ui_show`.
 *    The `post-model-call` hook is the deterministic backstop if the model
 *    ends its turn without rendering.
 *
 * Convention: default export is the function the harness invokes.
 */

import type { PostToolUseContext } from "@vellumai/plugin-api";

import {
  detectCapabilityEdit,
  extractDiffText,
  findToolUse,
} from "../src/detect.js";
import { appendHistoryEvent } from "../src/history.js";
import { buildInlineNudge } from "../src/nudge.js";
import { getPendingCapabilities, recordCapabilityEdit } from "../src/state.js";

export default async function postToolUse(
  ctx: PostToolUseContext,
): Promise<void> {
  const { toolResponse } = ctx;
  if (toolResponse.is_error === true) {
    return;
  }

  const toolUse = findToolUse(ctx.messages, toolResponse.tool_use_id);
  if (toolUse === null) {
    return;
  }

  const edit = detectCapabilityEdit(toolUse, toolResponse.content);
  if (edit === null) {
    return;
  }

  const { ref, change } = edit;

  appendHistoryEvent({
    conversationId: ctx.conversationId,
    kind: ref.kind,
    name: ref.name,
    file: ref.file,
    change,
    tool: toolUse.name,
    diff: extractDiffText(toolUse.name, toolResponse.content),
  });

  const { shouldNudge } = recordCapabilityEdit(ctx.conversationId, ref, change);

  if (shouldNudge) {
    ctx.additionalContext = buildInlineNudge(
      getPendingCapabilities(ctx.conversationId),
    );
  }

  ctx.logger.info(
    {
      plugin: "level-up",
      conversationId: ctx.conversationId,
      kind: ref.kind,
      name: ref.name,
      file: ref.file,
      change,
      nudged: shouldNudge,
    },
    "level-up recorded a capability edit",
  );
}
