/**
 * Behavioral tests for the level-up `stop` hook (the card backstop).
 *
 * Run with: `bun test __tests__/stop.test.ts`
 */

import { beforeEach, describe, expect, test } from "bun:test";

import stop from "../hooks/stop.ts";
import {
  __resetForTests,
  hasPendingCapabilities,
  recordCapabilityEdit,
} from "../src/state.ts";
import { assistantToolCall, stopCtx, userText } from "./_helpers.ts";

beforeEach(() => {
  __resetForTests();
});

describe("level-up stop hook", () => {
  test("forces a follow-up turn when the model ended without a card", async () => {
    // GIVEN the turn recorded a skill edit but rendered no ui_show card
    recordCapabilityEdit("conv-A", { kind: "skill", name: "sanity", file: "SKILL.md" }, false);
    const ctx = stopCtx({
      conversationId: "conv-A",
      messages: [userText("improve the sanity skill")],
    });

    // WHEN the stop hook runs
    await stop(ctx);

    // THEN it continues the loop and injects a level-up nudge message
    expect(ctx.decision).toBe("continue");
    const last = ctx.messages.at(-1);
    expect(last?.role).toBe("user");
    expect((last?.content[0] as { text: string }).text).toContain("[level-up]");
    // AND the batch is drained so a later stop won't re-trigger
    expect(hasPendingCapabilities("conv-A")).toBe(false);
  });

  test("does not force a turn when the model already rendered a card", async () => {
    // GIVEN the turn recorded an edit AND the model already called ui_show
    recordCapabilityEdit("conv-A", { kind: "plugin", name: "level-up", file: "hooks/stop.ts" }, false);
    const ctx = stopCtx({
      conversationId: "conv-A",
      messages: [
        userText("improve the plugin"),
        assistantToolCall("call-1", "file_edit", { path: "plugins/level-up/hooks/stop.ts" }),
        assistantToolCall("call-2", "ui_show", { surface_type: "work_result" }),
      ],
    });

    // WHEN the stop hook runs
    await stop(ctx);

    // THEN it leaves the run stopped and injects nothing
    expect(ctx.decision).toBe("stop");
    expect(ctx.messages).toHaveLength(3);
    // AND the batch is still drained
    expect(hasPendingCapabilities("conv-A")).toBe(false);
  });

  test("is a no-op when nothing was recorded this turn", async () => {
    // GIVEN no capability edits were recorded
    const ctx = stopCtx({
      conversationId: "conv-A",
      messages: [userText("hello")],
    });

    // WHEN the stop hook runs
    await stop(ctx);

    // THEN the run stops normally with no injected messages
    expect(ctx.decision).toBe("stop");
    expect(ctx.messages).toHaveLength(1);
  });
});
