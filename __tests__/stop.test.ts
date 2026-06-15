/**
 * Behavioral tests for the level-up `stop` hook.
 *
 * The terminal `stop` boundary cannot continue the turn (its `messages` are
 * read-only and it carries no `decision`), so the forced "Level Up" render
 * lives in the `post-model-call` hook. This hook's only job is to flush the
 * conversation's ephemeral per-turn state so the next turn starts clean.
 *
 * Run with: `bun test __tests__/stop.test.ts`
 */

import { beforeEach, describe, expect, test } from "bun:test";

import stop from "../hooks/stop.ts";
import {
  __resetForTests,
  hasPendingCapabilities,
  markForcedRender,
  recordCapabilityEdit,
} from "../src/state.ts";
import { stopCtx, userText } from "./_helpers.ts";

beforeEach(() => {
  __resetForTests();
});

describe("level-up stop hook", () => {
  test("drains the pending batch recorded this turn", async () => {
    // GIVEN the turn recorded a skill edit
    recordCapabilityEdit(
      "conv-A",
      { kind: "skill", name: "sanity", file: "SKILL.md" },
      "updated",
    );
    // AND a forced-render mark was set this turn
    markForcedRender("conv-A");
    const ctx = stopCtx({
      conversationId: "conv-A",
      messages: [userText("improve the sanity skill")],
    });

    // WHEN the stop hook runs
    await stop(ctx);

    // THEN the batch is drained so the next turn starts clean
    expect(hasPendingCapabilities("conv-A")).toBe(false);
    // AND the forced-render mark is cleared, so a fresh turn can force again
    expect(markForcedRender("conv-A")).toBe(true);
  });

  test("only flushes the conversation it was called for", async () => {
    // GIVEN two conversations each recorded an edit
    recordCapabilityEdit(
      "conv-A",
      { kind: "plugin", name: "level-up", file: "hooks/stop.ts" },
      "updated",
    );
    recordCapabilityEdit(
      "conv-B",
      { kind: "skill", name: "other", file: "SKILL.md" },
      "created",
    );

    // WHEN the stop hook runs for conv-A only
    await stop(stopCtx({ conversationId: "conv-A", messages: [] }));

    // THEN conv-A is drained but conv-B's batch is untouched
    expect(hasPendingCapabilities("conv-A")).toBe(false);
    expect(hasPendingCapabilities("conv-B")).toBe(true);
  });

  test("is a no-op when nothing was recorded this turn", async () => {
    // GIVEN no capability edits were recorded
    const ctx = stopCtx({
      conversationId: "conv-A",
      messages: [userText("hello")],
    });

    // WHEN the stop hook runs
    await stop(ctx);

    // THEN there is still no pending batch
    expect(hasPendingCapabilities("conv-A")).toBe(false);
  });
});
