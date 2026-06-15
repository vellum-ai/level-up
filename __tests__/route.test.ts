/**
 * Behavioral tests for the `routes/level-up.ts` user-route handler that serves
 * the durable history at `GET /v1/x/level-up`.
 *
 * The handler derives the history file location from its own path
 * (`<workspace>/routes/level-up.ts` → `<workspace>/plugins-data/level-up/...`).
 * When imported here it resolves the workspace to this repo root, so the tests
 * stage the file under `<repo>/plugins-data/level-up/` and clean it up after.
 *
 * Run with: `bun test __tests__/route.test.ts`
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { description, GET } from "../routes/level-up.ts";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(repoRoot, "plugins-data", "level-up");
const historyFile = join(dataDir, "history.json");

function writeHistory(contents: string): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(historyFile, contents, "utf-8");
}

beforeEach(() => {
  rmSync(join(repoRoot, "plugins-data"), { recursive: true, force: true });
});

afterEach(() => {
  rmSync(join(repoRoot, "plugins-data"), { recursive: true, force: true });
});

describe("level-up route handler", () => {
  test("serves the events from the history file as JSON", async () => {
    // GIVEN a history file with two recorded events
    const events = [
      {
        id: "1-1",
        timestamp: "2026-06-01T00:00:00.000Z",
        conversationId: "conv-A",
        kind: "skill",
        name: "sanity",
        file: "SKILL.md",
        change: "updated",
        tool: "file_edit",
        diff: "@@ -1 +1 @@\n-old\n+new",
      },
      {
        id: "2-2",
        timestamp: "2026-06-02T00:00:00.000Z",
        conversationId: "conv-A",
        kind: "plugin",
        name: "level-up",
        file: "hooks/stop.ts",
        change: "updated",
        tool: "file_edit",
        diff: null,
      },
    ];
    writeHistory(JSON.stringify({ version: 1, events }));

    // WHEN the GET handler runs
    const response = GET();

    // THEN it returns 200 with the events intact
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = (await response.json()) as { version: number; events: unknown[] };
    expect(payload.version).toBe(1);
    expect(payload.events).toEqual(events);
  });

  test("returns an empty log when the history file does not exist", async () => {
    // GIVEN no history file has been written

    // WHEN the GET handler runs
    const response = GET();

    // THEN it degrades to a valid empty, versioned envelope
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { version: number; events: unknown[] };
    expect(payload).toEqual({ version: 1, events: [] });
  });

  test("returns an empty log when the history file is corrupt", async () => {
    // GIVEN a history file containing invalid JSON
    writeHistory("{ not valid json");

    // WHEN the GET handler runs
    const response = GET();

    // THEN it degrades to empty rather than failing the request
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { version: number; events: unknown[] };
    expect(payload).toEqual({ version: 1, events: [] });
  });

  test("exports a human-readable description for route listings", () => {
    // GIVEN the handler module
    // WHEN its description is read
    // THEN it is a non-empty string
    expect(typeof description).toBe("string");
    expect(description.length).toBeGreaterThan(0);
  });
});
