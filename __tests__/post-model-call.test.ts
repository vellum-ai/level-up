/**
 * Behavioral tests for the level-up `post-model-call` hook — the deterministic
 * backstop that shows the "Level Up" card by appending a synthetic `ui_show`
 * tool call to the finalized reply when the model ends its turn without one.
 *
 * Run with: `bun test __tests__/post-model-call.test.ts`
 */

import type { ToolUseContent } from "@vellumai/plugin-api";

import { beforeEach, describe, expect, test } from "bun:test";

import postModelCall from "../hooks/post-model-call.ts";
import { LEVEL_UP_APP_HREF, skillHistoryHref } from "../src/nudge.ts";
import {
  __resetForTests,
  hasPendingCapabilities,
  recordCapabilityEdit,
} from "../src/state.ts";
import {
  assistantToolCall,
  postModelCallCtx,
  toolUseBlock,
  userText,
} from "./_helpers.ts";

beforeEach(() => {
  __resetForTests();
});

function recordEdit(conversationId: string, diff: string | null = null): void {
  recordCapabilityEdit(
    conversationId,
    { kind: "skill", name: "sanity", file: "SKILL.md" },
    "updated",
    diff,
  );
}

/** Find the injected `ui_show` block on a finalized reply, if any. */
function injectedCard(content: readonly unknown[]): ToolUseContent | undefined {
  return content.find(
    (block): block is ToolUseContent =>
      (block as ToolUseContent).type === "tool_use" &&
      (block as ToolUseContent).name === "ui_show",
  );
}

describe("level-up post-model-call hook", () => {
  test("appends a ui_show card when a no-tool reply lands with the card unrendered", async () => {
    // GIVEN the turn edited a skill but the model's reply rendered no card
    recordEdit("conv-A");
    const ctx = postModelCallCtx({
      conversationId: "conv-A",
      messages: [userText("improve the sanity skill")],
      content: [{ type: "text", text: "Done — I improved the skill." }],
    });

    // WHEN the hook runs
    await postModelCall(ctx);

    // THEN it appends a ui_show work_result card without discarding the reply
    expect(ctx.decision).toBe("stop");
    expect(ctx.content).toHaveLength(2);
    expect(ctx.content[0]).toEqual({
      type: "text",
      text: "Done — I improved the skill.",
    });
    const card = injectedCard(ctx.content);
    expect(card).toBeDefined();
    expect(card?.id).toBe("");
    expect(card?.input.surface_type).toBe("work_result");
  });

  test("builds the card payload from the pending batch, with a link to the skill's History tab", async () => {
    // GIVEN a diff-bearing skill edit is pending
    recordEdit("conv-A", "@@ -1 +1 @@\n-old line\n+new line");
    const ctx = postModelCallCtx({
      conversationId: "conv-A",
      messages: [userText("improve the sanity skill")],
      content: [{ type: "text", text: "Improved it." }],
    });

    // WHEN the hook runs
    await postModelCall(ctx);

    // THEN the card carries a compact diff preview and a History row that
    // opens the skill's page on its History tab
    const card = injectedCard(ctx.content);
    const data = card?.input.data as {
      sections: Array<Record<string, unknown>>;
    };
    const diffSection = data.sections.find((s) => s.type === "diff");
    expect(diffSection).toBeDefined();
    const diffs = diffSection?.diffs as Array<{ before: string; after: string }>;
    expect(diffs[0]?.before).toContain("old line");
    expect(diffs[0]?.after).toContain("new line");

    const linkSection = data.sections.find((s) => s.type === "items");
    expect(linkSection?.title).toBe("History");
    const items = linkSection?.items as Array<{ href: string }>;
    expect(items).toHaveLength(1);
    expect(items[0]?.href).toBe(skillHistoryHref("sanity"));
    expect(items[0]?.href).toBe("/assistant/skills/sanity?tab=history");
  });

  test("links plugin edits and deleted skills to the Level Up app, one row per target", async () => {
    // GIVEN a batch with a plugin edit, a deleted skill, and a live skill
    recordCapabilityEdit(
      "conv-A",
      { kind: "plugin", name: "greeter", file: "hooks/init.ts" },
      "updated",
      null,
    );
    recordCapabilityEdit(
      "conv-A",
      { kind: "skill", name: "retired", file: "SKILL.md" },
      "deleted",
      null,
    );
    recordEdit("conv-A");
    const ctx = postModelCallCtx({
      conversationId: "conv-A",
      messages: [userText("tidy up my capabilities")],
      content: [{ type: "text", text: "Tidied." }],
    });

    // WHEN the hook runs
    await postModelCall(ctx);

    // THEN the plugin and the deleted skill share one Level Up app row (a
    // deleted skill's page would be "not found"), and the live skill gets its
    // own History-tab row
    const card = injectedCard(ctx.content);
    const data = card?.input.data as {
      sections: Array<Record<string, unknown>>;
    };
    const linkSection = data.sections.find((s) => s.type === "items");
    const items = linkSection?.items as Array<{ href: string; title: string }>;
    expect(items.map((item) => item.href)).toEqual([
      LEVEL_UP_APP_HREF,
      skillHistoryHref("sanity"),
    ]);
  });

  test("does not append a card when one was already rendered this turn", async () => {
    // GIVEN the model already called ui_show this turn
    recordEdit("conv-A");
    const ctx = postModelCallCtx({
      conversationId: "conv-A",
      messages: [
        userText("improve the sanity skill"),
        assistantToolCall("call-1", "file_edit", {
          path: "skills/sanity/SKILL.md",
        }),
        assistantToolCall("call-2", "ui_show", { surface_type: "work_result" }),
      ],
      // The finalized no-tool reply that follows the rendered card
      content: [{ type: "text", text: "All set." }],
    });

    // WHEN the hook runs
    await postModelCall(ctx);

    // THEN it injects nothing and leaves the reply untouched
    expect(ctx.decision).toBe("stop");
    expect(ctx.content).toHaveLength(1);
    expect(injectedCard(ctx.content)).toBeUndefined();
  });

  test("does not re-inject on the follow-up turn its own card triggered", async () => {
    // GIVEN the prior turn's reply already carries the hook-injected ui_show
    recordEdit("conv-A");
    const ctx = postModelCallCtx({
      conversationId: "conv-A",
      messages: [
        userText("improve the sanity skill"),
        {
          role: "assistant",
          content: [
            { type: "text", text: "Done — I improved the skill." },
            toolUseBlock("", "ui_show", { surface_type: "work_result" }),
          ],
        },
      ],
      // The follow-up turn the executed ui_show re-entry produced
      content: [{ type: "text", text: "Anything else?" }],
    });

    // WHEN the hook runs again on that follow-up turn
    await postModelCall(ctx);

    // THEN the rendered-card guard stops a second injection
    expect(injectedCard(ctx.content)).toBeUndefined();
    expect(ctx.content).toHaveLength(1);
  });

  test("skips a tool-bearing reply so the pending batch survives for the final reply", async () => {
    // GIVEN the reply being finalized still carries a tool_use block
    recordEdit("conv-A");
    const ctx = postModelCallCtx({
      conversationId: "conv-A",
      messages: [userText("improve the sanity skill")],
      content: [toolUseBlock("call-9", "file_edit", { path: "skills/sanity/SKILL.md" })],
    });

    // WHEN the hook runs
    await postModelCall(ctx);

    // THEN it does not inject, and the batch is retained for the no-tool reply
    expect(injectedCard(ctx.content)).toBeUndefined();
    expect(hasPendingCapabilities("conv-A")).toBe(true);
  });

  test("ignores non-mainAgent call sites", async () => {
    // GIVEN a background (subagent) model call with a pending edit
    recordEdit("conv-A");
    const ctx = postModelCallCtx({
      conversationId: "conv-A",
      messages: [userText("...")],
      content: [{ type: "text", text: "summary" }],
      callSite: "subagentSpawn",
    });

    // WHEN the hook runs
    await postModelCall(ctx);

    // THEN it never injects on a non-user-facing call
    expect(injectedCard(ctx.content)).toBeUndefined();
  });

  test("ignores provider rejections", async () => {
    // GIVEN a model call that ended in a provider error
    recordEdit("conv-A");
    const ctx = postModelCallCtx({
      conversationId: "conv-A",
      messages: [userText("...")],
      content: [],
      error: new Error("provider rejected the request"),
    });

    // WHEN the hook runs
    await postModelCall(ctx);

    // THEN it does not act on the error outcome
    expect(injectedCard(ctx.content)).toBeUndefined();
  });

  test("is a no-op when nothing was recorded this turn", async () => {
    // GIVEN no capability edits were recorded
    const ctx = postModelCallCtx({
      conversationId: "conv-A",
      messages: [userText("hello")],
      content: [{ type: "text", text: "hi" }],
    });

    // WHEN the hook runs
    await postModelCall(ctx);

    // THEN it does nothing
    expect(injectedCard(ctx.content)).toBeUndefined();
    expect(ctx.content).toHaveLength(1);
  });
});
