/**
 * Behavioral tests for the level-up `post-model-call` hook — the deterministic
 * backstop that forces a single follow-up turn to render the "Level Up" card
 * when the model ends its turn without one.
 *
 * Run with: `bun test __tests__/post-model-call.test.ts`
 */

import { beforeEach, describe, expect, test } from "bun:test";

import postModelCall from "../hooks/post-model-call.ts";
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

function recordEdit(conversationId: string): void {
  recordCapabilityEdit(
    conversationId,
    { kind: "skill", name: "sanity", file: "SKILL.md" },
    "updated",
  );
}

describe("level-up post-model-call hook", () => {
  test("forces one follow-up turn when a no-tool reply lands with the card unrendered", async () => {
    // GIVEN the turn edited a skill but the model's reply rendered no card
    recordEdit("conv-A");
    const ctx = postModelCallCtx({
      conversationId: "conv-A",
      messages: [userText("improve the sanity skill")],
      content: [{ type: "text", text: "Done — I improved the skill." }],
    });

    // WHEN the hook runs
    await postModelCall(ctx);

    // THEN it continues the loop with a fully-specified level-up nudge appended
    expect(ctx.decision).toBe("continue");
    const last = ctx.messages.at(-1);
    expect(last?.role).toBe("user");
    expect((last?.content[0] as { text: string }).text).toContain("[level-up]");
    expect((last?.content[0] as { text: string }).text).toContain("ui_show");
  });

  test("does not force a turn when the model already rendered a card", async () => {
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

    // THEN it leaves the run stopped and injects nothing
    expect(ctx.decision).toBe("stop");
    expect(ctx.messages).toHaveLength(3);
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

    // THEN it does not continue, and the batch is retained for the no-tool reply
    expect(ctx.decision).toBe("stop");
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

    // THEN it never forces a render on a non-user-facing call
    expect(ctx.decision).toBe("stop");
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
    expect(ctx.decision).toBe("stop");
  });

  test("forces at most one follow-up turn (one-shot guard)", async () => {
    // GIVEN a no-tool reply that already triggered one forced render
    recordEdit("conv-A");
    const first = postModelCallCtx({
      conversationId: "conv-A",
      messages: [userText("improve the sanity skill")],
      content: [{ type: "text", text: "Done." }],
    });
    await postModelCall(first);
    expect(first.decision).toBe("continue");

    // AND the model again ends without a card on the forced turn
    const second = postModelCallCtx({
      conversationId: "conv-A",
      messages: [...first.messages, { role: "assistant", content: [{ type: "text", text: "Still no card." }] }],
      content: [{ type: "text", text: "Still no card." }],
    });

    // WHEN the hook runs a second time
    await postModelCall(second);

    // THEN it refuses to loop again, so a non-compliant model cannot spin
    expect(second.decision).toBe("stop");
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
    expect(ctx.decision).toBe("stop");
  });
});
