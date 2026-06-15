/**
 * Behavioral tests for `installRoute` — the `init`-hook helper that seeds the
 * `routes/level-up.ts` handler into a workspace.
 *
 * The helper stamps an ownership marker as the file's first line and decides
 * what to write from what is already on disk: write when absent, refresh its
 * own (marker-bearing) handler when stale, and never clobber a user's own
 * handler that happens to live at the same path.
 *
 * Run with: `bun test __tests__/init.test.ts`
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { installRoute, ROUTE_OWNERSHIP_MARKER } from "../hooks/init.ts";
import { noopLogger } from "./_helpers.ts";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const bundledSource = readFileSync(
  join(repoRoot, "routes", "level-up.ts"),
  "utf-8",
);
const desired = `${ROUTE_OWNERSHIP_MARKER}\n${bundledSource}`;

let workspaceDir: string;
const targetOf = (dir: string): string => join(dir, "routes", "level-up.ts");

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "level-up-init-"));
});

afterEach(() => {
  rmSync(workspaceDir, { recursive: true, force: true });
});

describe("installRoute ownership guard", () => {
  test("writes the marker-stamped handler when no file exists", () => {
    // GIVEN a workspace with no route handler
    // WHEN the route is installed
    installRoute(workspaceDir, noopLogger);

    // THEN the bundled handler lands with the ownership marker as line one
    const written = readFileSync(targetOf(workspaceDir), "utf-8");
    expect(written.startsWith(ROUTE_OWNERSHIP_MARKER)).toBe(true);
    expect(written).toBe(desired);
  });

  test("refreshes its own handler when the on-disk copy is stale", () => {
    // GIVEN a marker-bearing handler whose body is out of date
    mkdirSync(join(workspaceDir, "routes"), { recursive: true });
    writeFileSync(
      targetOf(workspaceDir),
      `${ROUTE_OWNERSHIP_MARKER}\n// stale body from an older plugin version\n`,
      "utf-8",
    );

    // WHEN the route is installed again
    installRoute(workspaceDir, noopLogger);

    // THEN its own handler is refreshed to the current bundled source
    expect(readFileSync(targetOf(workspaceDir), "utf-8")).toBe(desired);
  });

  test("leaves a user's own unmarked handler untouched", () => {
    // GIVEN a hand-authored handler at the same path, with no marker
    mkdirSync(join(workspaceDir, "routes"), { recursive: true });
    const userHandler = "export function GET() {\n  return { mine: true };\n}\n";
    writeFileSync(targetOf(workspaceDir), userHandler, "utf-8");

    // WHEN the route install runs
    installRoute(workspaceDir, noopLogger);

    // THEN the user's handler is preserved, never overwritten
    expect(readFileSync(targetOf(workspaceDir), "utf-8")).toBe(userHandler);
  });
});
