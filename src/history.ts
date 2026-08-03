/**
 * Durable, append-only log of the assistant's self-improvement edits.
 *
 * The `post-tool-use` hook records every skill/plugin edit here as it
 * happens, independent of whether the model renders a card that turn. The
 * log is the source of truth the bundled Level Up app reads (via the
 * `routes/level-up.ts` handler at `GET /v1/x/level-up`) to render its
 * git-style history view.
 *
 * Storage lives in the plugin's writable data directory
 * (`<workspaceDir>/plugins-data/level-up/history.json`). The `init` hook
 * supplies that absolute path; everything here is otherwise free of host
 * coupling so it can be unit-tested with a temp dir.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import type { CapabilityChange, CapabilityKind } from "./detect.js";

/** Basename of the durable log inside the plugin storage directory. */
export const HISTORY_FILE = "history.json";

/**
 * Upper bound on retained events. The log is a rolling window: once it grows
 * past this, the oldest events are dropped on the next append. Keeps the file
 * (and the app's payload) bounded without a separate compaction job.
 */
export const MAX_EVENTS = 1000;

/** Current on-disk schema version, bumped if the event shape changes. */
export const HISTORY_VERSION = 1;

/** A single recorded self-improvement edit. */
export interface HistoryEvent {
  /** Stable unique id (`<epoch-ms>-<seq>`), assigned on append. */
  readonly id: string;
  /** ISO-8601 timestamp of when the edit was recorded. */
  readonly timestamp: string;
  /** Conversation the edit happened in. */
  readonly conversationId: string;
  /** Whether the edited capability is a skill or a plugin. */
  readonly kind: CapabilityKind;
  /** Directory name of the skill/plugin, e.g. `"sanity"`. */
  readonly name: string;
  /** Path of the edited file relative to the capability root, e.g. `"SKILL.md"`. */
  readonly file: string;
  /** How the capability changed. */
  readonly change: CapabilityChange;
  /** The tool that produced the edit, e.g. `"file_edit"`. */
  readonly tool: string;
  /**
   * Unified-diff text for filesystem edits, as emitted in the tool result.
   * `null` for managed-skill authoring tools, which mutate through the store
   * and surface no diff text.
   */
  readonly diff: string | null;
}

/** On-disk envelope: a version stamp plus the rolling event window. */
export interface HistoryFile {
  readonly version: number;
  readonly events: HistoryEvent[];
}

/**
 * Absolute path to the plugin storage directory, set once by the `init`
 * hook. Hooks that run later (e.g. `post-tool-use`) read it from here rather
 * than re-deriving it, since their contexts do not carry a workspace path.
 */
let storageDir: string | null = null;

/** Monotonic per-process sequence to disambiguate events within one millisecond. */
let sequence = 0;

/**
 * Record the plugin storage directory. Called by the `init` hook with
 * {@link PluginInitContext.pluginStorageDir}.
 */
export function setStorageDir(dir: string | null): void {
  storageDir = dir;
}

/**
 * Storage locations to probe when `init` has not run in this process, in the
 * order the host has used them. Naming one shape outright appends history to a
 * directory the host does not use under the other, splitting the log across two
 * places, so probe for the one that actually exists.
 */
const FALLBACK_STORAGE_CANDIDATES = [
  ["plugins", "level-up", "data"],
  ["plugins-data", "level-up"],
] as const;

/**
 * Resolve the storage directory, falling back to the workspace env var when
 * `init` has not run in this process (e.g. an isolated unit of work). Returns
 * `null` when no location can be determined, so callers degrade quietly
 * rather than throwing inside a hook.
 *
 * The fallback never invents a directory: an absent one means the host has not
 * created storage for this plugin, and writing to a guessed path would strand
 * entries where nothing reads them.
 *
 * Exported for unit testing; callers use {@link historyPath}.
 */
export function resolveStorageDir(): string | null {
  if (storageDir !== null) {
    return storageDir;
  }
  const workspaceDir = process.env.VELLUM_WORKSPACE_DIR;
  if (workspaceDir === undefined || workspaceDir === "") {
    return null;
  }
  for (const segments of FALLBACK_STORAGE_CANDIDATES) {
    const candidate = join(workspaceDir, ...segments);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** Absolute path to the history file, or `null` when the location is unknown. */
export function historyPath(): string | null {
  const dir = resolveStorageDir();
  return dir === null ? null : join(dir, HISTORY_FILE);
}

function nextId(now: number): string {
  sequence += 1;
  return `${now}-${sequence}`;
}

/**
 * Read and parse the history file. Returns an empty log when the file is
 * absent or unparsable — a corrupt or partially-written file should never
 * crash a hook, and the next append rewrites it cleanly.
 */
export function readHistoryFrom(path: string): HistoryFile {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
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
      const { events } = parsed as { events: HistoryEvent[] };
      return { version: HISTORY_VERSION, events };
    }
  } catch {
    // fall through to empty
  }
  return { version: HISTORY_VERSION, events: [] };
}

/** Atomically write the history file (temp file + rename) to avoid torn reads. */
function writeHistoryTo(path: string, file: HistoryFile): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(file), "utf-8");
  renameSync(tmp, path);
}

/** The fields an appended event carries before an id/timestamp are assigned. */
export type HistoryEventInput = Omit<HistoryEvent, "id" | "timestamp">;

/**
 * Append an event to the durable log, trimming to {@link MAX_EVENTS}. No-ops
 * (returning `null`) when the storage location cannot be resolved. Returns the
 * fully-formed event on success.
 */
export function appendHistoryEvent(
  input: HistoryEventInput,
): HistoryEvent | null {
  const path = historyPath();
  if (path === null) {
    return null;
  }

  const now = Date.now();
  const event: HistoryEvent = {
    id: nextId(now),
    timestamp: new Date(now).toISOString(),
    ...input,
  };

  const file = readHistoryFrom(path);
  const events = [...file.events, event];
  const trimmed =
    events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
  writeHistoryTo(path, { version: HISTORY_VERSION, events: trimmed });
  return event;
}

/** Test-only: reset module state between cases. */
export function __resetForTests(): void {
  storageDir = null;
  sequence = 0;
}
