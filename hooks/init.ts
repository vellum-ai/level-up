/**
 * `init` hook — bootstraps everything the Level Up plugin needs on disk so
 * its history is durable and viewable.
 *
 * It runs once at daemon startup and does three things:
 *
 * 1. Wires the durable history module to this plugin's writable data
 *    directory (`ctx.pluginStorageDir`), so later hooks append events there.
 * 2. Upserts the bundled, multifile (formatVersion 2) "Level Up" app into the
 *    workspace apps directory. Source is written only — the host compiles
 *    `dist/` on first open — and seeding is idempotent: once the definition
 *    exists the app is user-owned and the template is never re-copied.
 * 3. Installs the custom route handler (`routes/level-up.ts`) that serves the
 *    history at `GET /v1/x/level-up`, which the app fetches. The handler is
 *    plugin-owned glue, so it is refreshed whenever the bundled copy changes.
 *
 * Per the daemon's startup philosophy, a failure in any step is logged and
 * swallowed rather than thrown, so the plugin degrades gracefully instead of
 * blocking startup.
 *
 * Convention: default export is the function the harness invokes.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PluginInitContext, PluginLogger } from "@vellumai/plugin-api";

import { setStorageDir } from "../src/history.js";

/** Well-known id and directory slug of the bundled app. */
const APP_ID = "level-up";

/** Basename of the installed route handler under `<workspace>/routes/`. */
const ROUTE_FILE = "level-up.ts";

/** Absolute path to this plugin's install root (the parent of `hooks/`). */
function pluginRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

/**
 * Derive the workspace root from the plugin storage directory, which the host
 * documents as `<workspaceDir>/plugins-data/<plugin>/`.
 */
function workspaceRoot(pluginStorageDir: string): string {
  return dirname(dirname(pluginStorageDir));
}

/**
 * Upsert the bundled app's source and definition into the workspace apps
 * directory. Mirrors the host's own preloaded-app seeding: write source files
 * plus an empty root `index.html` (the real entrypoint is `src/index.html`,
 * compiled into `dist/` on first open), then the definition JSON. Once the
 * definition exists the app is considered user-owned and left untouched.
 */
function upsertApp(appsDir: string, logger: PluginLogger): void {
  const definitionPath = join(appsDir, `${APP_ID}.json`);
  if (existsSync(definitionPath)) {
    return;
  }

  const templateSrc = join(pluginRoot(), "app", "src");
  if (!existsSync(templateSrc)) {
    logger.warn(
      { plugin: "level-up", templateSrc },
      "level-up app source missing from plugin bundle — skipping app upsert",
    );
    return;
  }

  const appDir = join(appsDir, APP_ID);
  mkdirSync(appsDir, { recursive: true });
  cpSync(templateSrc, join(appDir, "src"), { recursive: true });
  writeFileSync(join(appDir, "index.html"), "", "utf-8");

  const now = Date.now();
  const definition = {
    id: APP_ID,
    name: "Level Up",
    description:
      "A git-style history of how the assistant has improved its own skills and plugins.",
    icon: "🆙",
    schemaJson: "{}",
    htmlDefinition: "",
    createdAt: now,
    updatedAt: now,
    formatVersion: 2,
    dirName: APP_ID,
  };
  writeFileSync(definitionPath, JSON.stringify(definition, null, 2), "utf-8");
  logger.info({ plugin: "level-up", appDir }, "level-up app seeded");
}

/**
 * Install (or refresh) the route handler that serves the history. Written
 * whenever the on-disk copy differs from the bundled template so plugin
 * upgrades propagate, but skipped when already current to avoid churn.
 */
function installRoute(workspaceDir: string, logger: PluginLogger): void {
  const source = join(pluginRoot(), "routes", ROUTE_FILE);
  if (!existsSync(source)) {
    logger.warn(
      { plugin: "level-up", source },
      "level-up route handler missing from plugin bundle — skipping route install",
    );
    return;
  }

  const routesDir = join(workspaceDir, "routes");
  const target = join(routesDir, ROUTE_FILE);
  const desired = readFileSync(source, "utf-8");
  if (existsSync(target) && readFileSync(target, "utf-8") === desired) {
    return;
  }

  mkdirSync(routesDir, { recursive: true });
  writeFileSync(target, desired, "utf-8");
  logger.info({ plugin: "level-up", target }, "level-up route handler installed");
}

export default async function init(ctx: PluginInitContext): Promise<void> {
  setStorageDir(ctx.pluginStorageDir);

  const workspaceDir = workspaceRoot(ctx.pluginStorageDir);

  try {
    upsertApp(join(workspaceDir, "data", "apps"), ctx.logger);
  } catch (error) {
    ctx.logger.error(
      { plugin: "level-up", err: error },
      "level-up failed to upsert its app",
    );
  }

  try {
    installRoute(workspaceDir, ctx.logger);
  } catch (error) {
    ctx.logger.error(
      { plugin: "level-up", err: error },
      "level-up failed to install its route handler",
    );
  }
}
