/**
 * Behavioral tests for the level-up `post-tool-use` hook.
 *
 * Run with: `bun test __tests__/post-tool-use.test.ts`
 */

import { beforeEach, describe, expect, test } from "bun:test";

import postToolUse from "../hooks/post-tool-use.ts";
import {
  __resetForTests,
  getPendingCapabilities,
} from "../src/state.ts";
import { assistantToolCall, postToolUseCtx, toolResult, userText } from "./_helpers.ts";

beforeEach(() => {
  __resetForTests();
});

describe("level-up post-tool-use hook", () => {
  test("records a skill edit and nudges the model on the first edit of a batch", async () => {
    // GIVEN the assistant edited its sanity skill via file_edit
    const messages = [
      userText("improve the sanity skill"),
      assistantToolCall("call-1", "file_edit", { path: "skills/sanity/SKILL.md" }),
    ];
    const ctx = postToolUseCtx({
      conversationId: "conv-A",
      messages,
      toolResponse: toolResult("call-1", "Applied 1 edit (+20 -2)"),
    });

    // WHEN the hook runs
    await postToolUse(ctx);

    // THEN the edit is recorded against the conversation
    expect(getPendingCapabilities("conv-A")).toEqual([
      { kind: "skill", name: "sanity", files: ["SKILL.md"], change: "updated" },
    ]);
    // AND the model is nudged to render the Level Up card
    expect(ctx.additionalContext).toContain("[level-up]");
    expect(ctx.additionalContext).toContain("ui_show");
  });

  test("merges a second edit to the same skill without re-nudging", async () => {
    // GIVEN one edit was already recorded this turn
    const firstCtx = postToolUseCtx({
      conversationId: "conv-A",
      messages: [
        assistantToolCall("call-1", "file_edit", { path: "skills/sanity/SKILL.md" }),
      ],
      toolResponse: toolResult("call-1", "Applied 1 edit (+20 -2)"),
    });
    await postToolUse(firstCtx);

    // AND a second edit touches a different file in the same skill
    const secondCtx = postToolUseCtx({
      conversationId: "conv-A",
      messages: [
        assistantToolCall("call-2", "file_write", {
          path: "skills/sanity/references/api.md",
        }),
      ],
      toolResponse: toolResult("call-2", "Wrote file (new file, 30 lines)"),
    });

    // WHEN the hook runs for the second edit
    await postToolUse(secondCtx);

    // THEN both files are collected under one capability, marked created
    expect(getPendingCapabilities("conv-A")).toEqual([
      {
        kind: "skill",
        name: "sanity",
        files: ["SKILL.md", "references/api.md"],
        change: "created",
      },
    ]);
    // AND the model is not nudged again for the same batch
    expect(secondCtx.additionalContext).toBeUndefined();
  });

  test("ignores edits outside the skills/plugins trees", async () => {
    // GIVEN an edit to ordinary source code
    const ctx = postToolUseCtx({
      conversationId: "conv-A",
      messages: [
        assistantToolCall("call-1", "file_edit", { path: "assistant/src/loop.ts" }),
      ],
      toolResponse: toolResult("call-1", "Applied 1 edit (+1 -1)"),
    });

    // WHEN the hook runs
    await postToolUse(ctx);

    // THEN nothing is recorded and no nudge is emitted
    expect(getPendingCapabilities("conv-A")).toEqual([]);
    expect(ctx.additionalContext).toBeUndefined();
  });

  test("ignores failed tool results", async () => {
    // GIVEN a skill edit that errored
    const ctx = postToolUseCtx({
      conversationId: "conv-A",
      messages: [
        assistantToolCall("call-1", "file_edit", { path: "skills/sanity/SKILL.md" }),
      ],
      toolResponse: toolResult("call-1", "error: no such file", true),
    });

    // WHEN the hook runs
    await postToolUse(ctx);

    // THEN the failed edit is not recorded
    expect(getPendingCapabilities("conv-A")).toEqual([]);
  });

  test("ignores non-filesystem tools", async () => {
    // GIVEN a non-edit tool whose input happens to carry a skill-shaped path
    const ctx = postToolUseCtx({
      conversationId: "conv-A",
      messages: [
        assistantToolCall("call-1", "web_search", { path: "skills/sanity/SKILL.md" }),
      ],
      toolResponse: toolResult("call-1", "results..."),
    });

    // WHEN the hook runs
    await postToolUse(ctx);

    // THEN nothing is recorded
    expect(getPendingCapabilities("conv-A")).toEqual([]);
  });

  test("records a managed skill creation via scaffold_managed_skill", async () => {
    // GIVEN the assistant created a new skill through the managed-skill tool
    // (which writes SKILL.md through the store, not a path-bearing file_write)
    const ctx = postToolUseCtx({
      conversationId: "conv-A",
      messages: [
        userText("create a skill called bam"),
        assistantToolCall("call-1", "scaffold_managed_skill", {
          skill_id: "bam",
          name: "BAM",
          description: "When to use the BAM sound effect",
          body_markdown: "# BAM\n...",
        }),
      ],
      toolResponse: toolResult(
        "call-1",
        JSON.stringify({ created: true, skill_id: "bam", path: "skills/bam" }),
      ),
    });

    // WHEN the hook runs
    await postToolUse(ctx);

    // THEN the skill is recorded as created and the model is nudged
    expect(getPendingCapabilities("conv-A")).toEqual([
      { kind: "skill", name: "bam", files: ["SKILL.md"], change: "created" },
    ]);
    expect(ctx.additionalContext).toContain("[level-up]");
  });

  test("records an overwrite via scaffold_managed_skill as an update", async () => {
    // GIVEN the assistant overwrote an existing skill
    const ctx = postToolUseCtx({
      conversationId: "conv-A",
      messages: [
        assistantToolCall("call-1", "scaffold_managed_skill", {
          skill_id: "bam",
          name: "BAM",
          description: "Updated guidance",
          body_markdown: "# BAM\n...",
          overwrite: true,
        }),
      ],
      toolResponse: toolResult(
        "call-1",
        JSON.stringify({ created: true, skill_id: "bam", path: "skills/bam" }),
      ),
    });

    // WHEN the hook runs
    await postToolUse(ctx);

    // THEN the skill is recorded as updated
    expect(getPendingCapabilities("conv-A")).toEqual([
      { kind: "skill", name: "bam", files: ["SKILL.md"], change: "updated" },
    ]);
  });

  test("records a managed skill deletion via delete_managed_skill", async () => {
    // GIVEN the assistant deleted a managed skill
    const ctx = postToolUseCtx({
      conversationId: "conv-A",
      messages: [
        assistantToolCall("call-1", "delete_managed_skill", { skill_id: "bam" }),
      ],
      toolResponse: toolResult(
        "call-1",
        JSON.stringify({ deleted: true, skill_id: "bam" }),
      ),
    });

    // WHEN the hook runs
    await postToolUse(ctx);

    // THEN the skill is recorded as deleted and the model is nudged
    expect(getPendingCapabilities("conv-A")).toEqual([
      { kind: "skill", name: "bam", files: ["SKILL.md"], change: "deleted" },
    ]);
    expect(ctx.additionalContext).toContain("[level-up]");
  });
});
