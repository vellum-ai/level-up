/**
 * Behavioral tests for the durable self-improvement history log.
 *
 * Run with: `bun test __tests__/history.test.ts`
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  __resetForTests,
  appendHistoryEvent,
  HISTORY_FILE,
  HISTORY_VERSION,
  historyPath,
  MAX_EVENTS,
  readHistoryFrom,
  setStorageDir,
} from "../src/history.ts";

let storageDir: string;

beforeEach(() => {
  __resetForTests();
  storageDir = mkdtempSync(join(tmpdir(), "level-up-history-"));
  setStorageDir(storageDir);
});

afterEach(() => {
  rmSync(storageDir, { recursive: true, force: true });
});

const baseEvent = {
  conversationId: "conv-A",
  kind: "skill" as const,
  name: "sanity",
  file: "SKILL.md",
  change: "updated" as const,
  tool: "file_edit",
  diff: "@@ -1 +1 @@\n-old\n+new",
};

describe("history log", () => {
  test("appends an event, assigning an id and ISO timestamp", () => {
    // GIVEN an empty log

    // WHEN an event is appended
    const event = appendHistoryEvent(baseEvent);

    // THEN the returned event carries the input plus a generated id/timestamp
    expect(event).not.toBeNull();
    expect(event?.id).toMatch(/^\d+-\d+$/);
    expect(event?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // AND it is persisted to <storageDir>/history.json
    const path = historyPath();
    expect(path).toBe(join(storageDir, HISTORY_FILE));
    const file = readHistoryFrom(path as string);
    expect(file.version).toBe(HISTORY_VERSION);
    expect(file.events).toHaveLength(1);
    expect(file.events[0]).toMatchObject(baseEvent);
  });

  test("preserves insertion order across multiple appends", () => {
    // GIVEN three edits recorded in sequence
    appendHistoryEvent({ ...baseEvent, file: "a.md" });
    appendHistoryEvent({ ...baseEvent, file: "b.md" });
    appendHistoryEvent({ ...baseEvent, file: "c.md" });

    // WHEN the log is read back
    const { events } = readHistoryFrom(historyPath() as string);

    // THEN events are oldest-first in the file (the app reverses for display)
    expect(events.map((event) => event.file)).toEqual(["a.md", "b.md", "c.md"]);
    // AND each event has a distinct id
    expect(new Set(events.map((event) => event.id)).size).toBe(3);
  });

  test("trims the log to the most recent MAX_EVENTS", () => {
    // GIVEN more events than the retention bound are appended
    for (let i = 0; i < MAX_EVENTS + 5; i++) {
      appendHistoryEvent({ ...baseEvent, file: `f${i}.md` });
    }

    // WHEN the log is read back
    const { events } = readHistoryFrom(historyPath() as string);

    // THEN it is capped at MAX_EVENTS, keeping the newest and dropping the oldest
    expect(events).toHaveLength(MAX_EVENTS);
    expect(events[0]?.file).toBe("f5.md");
    expect(events.at(-1)?.file).toBe(`f${MAX_EVENTS + 4}.md`);
  });

  test("reads an empty log when the file does not exist", () => {
    // GIVEN a path with no file written yet
    const path = join(storageDir, "nonexistent.json");

    // WHEN the log is read
    const file = readHistoryFrom(path);

    // THEN it degrades to a valid empty, versioned envelope
    expect(file).toEqual({ version: HISTORY_VERSION, events: [] });
  });

  test("reads an empty log when the file is corrupt", () => {
    // GIVEN a history file containing invalid JSON
    const path = join(storageDir, HISTORY_FILE);
    writeFileSync(path, "{ this is not json", "utf-8");

    // WHEN the log is read
    const file = readHistoryFrom(path);

    // THEN it degrades to empty rather than throwing
    expect(file).toEqual({ version: HISTORY_VERSION, events: [] });
  });

  test("no-ops when the storage location cannot be resolved", () => {
    // GIVEN no storage dir is set and no workspace env var is available
    __resetForTests();
    const previous = process.env.VELLUM_WORKSPACE_DIR;
    delete process.env.VELLUM_WORKSPACE_DIR;
    try {
      // WHEN an append is attempted
      const event = appendHistoryEvent(baseEvent);

      // THEN it returns null and writes nothing
      expect(event).toBeNull();
      expect(historyPath()).toBeNull();
    } finally {
      if (previous !== undefined) {
        process.env.VELLUM_WORKSPACE_DIR = previous;
      }
    }
  });

  test("does not leave a temp file behind after an atomic write", () => {
    // GIVEN an appended event
    appendHistoryEvent(baseEvent);

    // WHEN the storage dir is inspected
    // THEN only the final history file exists, not the `.tmp` staging file
    expect(existsSync(join(storageDir, HISTORY_FILE))).toBe(true);
    expect(existsSync(join(storageDir, `${HISTORY_FILE}.tmp`))).toBe(false);
  });
});
