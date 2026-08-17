/**
 * Behavioral tests for the level-up `post-tool-use` hook.
 *
 * Run with: `bun test __tests__/post-tool-use.test.ts`
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import postToolUse from "../hooks/post-tool-use.ts";
import {
  __resetForTests as __resetHistory,
  historyPath,
  readHistoryFrom,
  setStorageDir,
} from "../src/history.ts";
import {
  __resetForTests,
  getPendingCapabilities,
} from "../src/state.ts";
import { assistantToolCall, postToolUseCtx, toolResult, userText } from "./_helpers.ts";

let storageDir: string;

beforeEach(() => {
  __resetForTests();
  __resetHistory();
  // Point the durable log at an isolated temp dir so the hook's history
  // append never touches a real workspace during tests.
  storageDir = mkdtempSync(join(tmpdir(), "level-up-ptu-"));
  setStorageDir(storageDir);
});

afterEach(() => {
  rmSync(storageDir, { recursive: true, force: true });
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
      {
        kind: "skill",
        name: "sanity",
        files: ["SKILL.md"],
        change: "updated",
        diff: null,
      },
    ]);
    // AND the model is nudged to render the Level Up card, linking the skill
    // to its page's History tab
    expect(ctx.additionalContext).toContain("[level-up]");
    expect(ctx.additionalContext).toContain("ui_show");
    expect(ctx.additionalContext).toContain(
      "/assistant/skills/sanity?tab=history",
    );
    // AND the edit is durably appended to the history log the app reads
    const path = historyPath();
    expect(path).not.toBeNull();
    const { events } = readHistoryFrom(path as string);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      conversationId: "conv-A",
      kind: "skill",
      name: "sanity",
      file: "SKILL.md",
      change: "updated",
      tool: "file_edit",
    });
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
        diff: null,
      },
    ]);
    // AND the model is not nudged again for the same batch
    expect(secondCtx.additionalContext).toBeUndefined();
  });

  test("captures the unified-diff text from a diff-bearing file_edit", async () => {
    // GIVEN a skill edit whose result carries a unified diff after the summary
    const ctx = postToolUseCtx({
      conversationId: "conv-A",
      messages: [
        assistantToolCall("call-1", "file_edit", { path: "skills/sanity/SKILL.md" }),
      ],
      toolResponse: toolResult(
        "call-1",
        "Applied 1 edit (+1 -1)\n@@ -1 +1 @@\n-old line\n+new line",
      ),
    });

    // WHEN the hook runs
    await postToolUse(ctx);

    // THEN the diff body is retained on the capability for the card preview
    expect(getPendingCapabilities("conv-A")).toEqual([
      {
        kind: "skill",
        name: "sanity",
        files: ["SKILL.md"],
        change: "updated",
        diff: "@@ -1 +1 @@\n-old line\n+new line",
      },
    ]);
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
      {
        kind: "skill",
        name: "bam",
        files: ["SKILL.md"],
        change: "created",
        diff: null,
      },
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
      {
        kind: "skill",
        name: "bam",
        files: ["SKILL.md"],
        change: "updated",
        diff: null,
      },
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
      {
        kind: "skill",
        name: "bam",
        files: ["SKILL.md"],
        change: "deleted",
        diff: null,
      },
    ]);
    expect(ctx.additionalContext).toContain("[level-up]");
  });
});
