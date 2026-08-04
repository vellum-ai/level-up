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

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

/**
 * Regression coverage for workspace-root derivation, driven through the real
 * `init` hook with the storage shape the runtime actually supplies.
 *
 * The host moved plugin storage from `<workspace>/plugins-data/<plugin>/` to
 * `<workspace>/plugins/<plugin>/data`. A fixed-depth derivation resolves one
 * level short under the new shape and seeds `plugins/data/apps` and
 * `plugins/routes`, where the host serves neither, leaving the app and route
 * silently absent. These assert the canonical destinations and, just as
 * importantly, that the malformed ones are never created.
 */
describe("workspace root derivation across host storage shapes", () => {
  /** Build a plugin dir whose bundle the init hook can copy from. */
  function installedShape(ws: string): string {
    const storage = join(ws, "plugins", "level-up", "data");
    mkdirSync(storage, { recursive: true });
    return storage;
  }

  function legacyShape(ws: string): string {
    const storage = join(ws, "plugins-data", "level-up");
    mkdirSync(storage, { recursive: true });
    return storage;
  }

  async function runInit(storageDir: string): Promise<void> {
    const init = (await import("../hooks/init.ts")).default;
    await init({
      pluginStorageDir: storageDir,
      logger: noopLogger,
      config: {},
      assistantVersion: "0.0.0-test",
    } as never);
  }

  test("the current installed shape seeds the canonical workspace locations", async () => {
    await runInit(installedShape(workspaceDir));

    // Canonical destinations, which is where the host serves them from.
    expect(existsSync(targetOf(workspaceDir))).toBe(true);
    expect(existsSync(join(workspaceDir, "data", "apps", "level-up.json"))).toBe(
      true,
    );

    // The regression itself: nothing may land under plugins/.
    expect(existsSync(join(workspaceDir, "plugins", "routes"))).toBe(false);
    expect(existsSync(join(workspaceDir, "plugins", "data"))).toBe(false);
  });

  test("the legacy storage shape still resolves to the same workspace root", async () => {
    await runInit(legacyShape(workspaceDir));

    expect(existsSync(targetOf(workspaceDir))).toBe(true);
    expect(existsSync(join(workspaceDir, "data", "apps", "level-up.json"))).toBe(
      true,
    );
  });

  test("an unrecognized storage shape writes nothing at all", async () => {
    const orphan = join(workspaceDir, "somewhere", "else");
    mkdirSync(orphan, { recursive: true });

    await runInit(orphan);

    // Skipping beats seeding into a guessed root.
    expect(existsSync(targetOf(workspaceDir))).toBe(false);
    expect(existsSync(join(workspaceDir, "data", "apps"))).toBe(false);
  });

  test("re-running init is idempotent and preserves a user-owned handler", async () => {
    const storage = installedShape(workspaceDir);
    await runInit(storage);

    // A user replaces the handler with their own, losing the ownership marker.
    writeFileSync(targetOf(workspaceDir), "export default () => {};", "utf-8");
    await runInit(storage);

    expect(readFileSync(targetOf(workspaceDir), "utf-8")).toBe(
      "export default () => {};",
    );
    expect(existsSync(join(workspaceDir, "plugins", "routes"))).toBe(false);
  });
});
