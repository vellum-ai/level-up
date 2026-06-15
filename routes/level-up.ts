/**
 * User-route handler that serves the Level Up plugin's durable edit history.
 *
 * Installed by the plugin's `init` hook into `<workspace>/routes/level-up.ts`
 * and served by the host at `GET /v1/x/level-up`. The bundled Level Up app
 * fetches this endpoint (via `window.vellum.fetch`) to render its git-style
 * history view.
 *
 * The handler is intentionally self-contained: the host loads route modules
 * with isolated, cache-busted dynamic imports, so it cannot rely on importing
 * the plugin's `src/`. It reads the history file directly with node stdlib.
 * The workspace directory is derived from this file's own location
 * (`<workspace>/routes/level-up.ts`) rather than an env var, so it resolves
 * correctly regardless of how the daemon was launched.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Description surfaced by the host when listing user routes. */
export const description =
  "Returns the Level Up plugin's durable self-improvement history.";

/** Current on-disk history schema version (mirrors the plugin's `history.ts`). */
const HISTORY_VERSION = 1;

interface HistoryFile {
  readonly version: number;
  readonly events: unknown[];
}

/**
 * Absolute path to `<workspace>/plugins-data/level-up/history.json`, resolved
 * from this handler's install location (`<workspace>/routes/level-up.ts`).
 * `import.meta.url` carries a cache-busting query when the host loads the
 * module; `fileURLToPath` reads only the path, so the query is ignored.
 */
function historyFilePath(): string {
  const routesDir = dirname(fileURLToPath(import.meta.url));
  const workspaceDir = dirname(routesDir);
  return join(workspaceDir, "plugins-data", "level-up", "history.json");
}

/**
 * Read and validate the history file. Returns an empty log when the file is
 * absent or unparsable so a fresh install (or a torn write) yields a valid
 * empty response rather than a 500.
 */
function readHistory(): HistoryFile {
  let raw: string;
  try {
    raw = readFileSync(historyFilePath(), "utf-8");
  } catch {
    return { version: HISTORY_VERSION, events: [] };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as { events?: unknown }).events)
    ) {
      return {
        version: HISTORY_VERSION,
        events: (parsed as { events: unknown[] }).events,
      };
    }
  } catch {
    // fall through to empty
  }
  return { version: HISTORY_VERSION, events: [] };
}

export function GET(): Response {
  const body = JSON.stringify(readHistory());
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}
