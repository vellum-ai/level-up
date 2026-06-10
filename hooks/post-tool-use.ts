/**
 * `post-tool-use` hook — detects when a filesystem tool edited one of the
 * assistant's own skills or plugins and accumulates it into a per-turn
 * batch.
 *
 * The hook fires once per tool result, before the result reaches the
 * provider. It is read-mostly: it records the edit in module state and, the
 * first time a batch opens for a conversation, appends an `additionalContext`
 * nudge (model-only) so the model renders a "Level Up" card with `ui_show`
 * before ending its turn. The `stop` hook is the deterministic backstop if
 * the model ends the turn without rendering.
 *
 * Convention: default export is the function the harness invokes.
 */

import type { PostToolUseContext } from "@vellumai/plugin-api";

import {
  classifyCapabilityPath,
  EDIT_TOOL_NAMES,
  findToolUse,
  getStringInput,
  resultLooksLikeNewFile,
} from "../src/detect.js";
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
  if (toolUse === null || !EDIT_TOOL_NAMES.has(toolUse.name)) {
    return;
  }

  const path = getStringInput(toolUse.input, "path");
  if (path === null) {
    return;
  }

  const ref = classifyCapabilityPath(path);
  if (ref === null) {
    return;
  }

  const created = resultLooksLikeNewFile(toolResponse.content);
  const { shouldNudge } = recordCapabilityEdit(ctx.conversationId, ref, created);

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
      created,
      nudged: shouldNudge,
    },
    "level-up recorded a capability edit",
  );
}
