/**
 * Pure helpers for recognizing edits the assistant makes to its own
 * skills and plugins.
 *
 * A "self-improvement" edit is a filesystem write/edit whose target path
 * lives inside the workspace `skills/<name>/…` or `plugins/<name>/…` tree.
 * Everything here is side-effect free so it can be unit-tested without a
 * daemon or a real workspace.
 */

import type { ContentBlock, Message, ToolUseContent } from "@vellumai/plugin-api";

/** Filesystem tools whose results we inspect for skill/plugin edits. */
export const EDIT_TOOL_NAMES: ReadonlySet<string> = new Set([
  "file_edit",
  "file_write",
  "host_file_edit",
  "host_file_write",
]);

/** A capability the assistant can edit and "level up". */
export type CapabilityKind = "skill" | "plugin";

export interface CapabilityRef {
  readonly kind: CapabilityKind;
  /** Directory name of the skill/plugin, e.g. `"sanity"`. */
  readonly name: string;
  /** Path of the edited file relative to the capability root, e.g. `"SKILL.md"`. */
  readonly file: string;
}

/**
 * Matches a path segment of the form `skills/<name>/<file…>` or
 * `plugins/<name>/<file…>`, anchored at the start of the string or a `/`.
 *
 * - Requires a slash directly after `skills`/`plugins`, so sibling dirs
 *   like `plugins-data/` (the per-plugin storage tree) never match.
 * - Requires a file path after the capability name, so the catalog index
 *   files (`skills/SKILLS.md`) and bare capability dirs are ignored.
 */
const CAPABILITY_PATH_RE = /(?:^|\/)(skills|plugins)\/([^/]+)\/(.+)$/;

/**
 * Classify an edited file path as a skill/plugin capability edit, or
 * `null` when the path is unrelated. Accepts absolute or workspace-relative
 * paths. Edits inside a capability's own `node_modules/` are ignored — they
 * are vendored dependencies, not authored capability content.
 */
export function classifyCapabilityPath(rawPath: string): CapabilityRef | null {
  const path = rawPath.replaceAll("\\", "/");
  const match = CAPABILITY_PATH_RE.exec(path);
  if (match === null) {
    return null;
  }
  const [, dir, name, file] = match;
  if (dir === undefined || name === undefined || file === undefined) {
    return null;
  }
  if (file.split("/").includes("node_modules")) {
    return null;
  }
  return {
    kind: dir === "skills" ? "skill" : "plugin",
    name,
    file,
  };
}

/**
 * Find the `tool_use` block that produced a given tool result by matching
 * its id. Scans newest-first since the issuing call is in the most recent
 * assistant turn.
 */
export function findToolUse(
  messages: ReadonlyArray<Message>,
  toolUseId: string,
): ToolUseContent | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message === undefined) {
      continue;
    }
    for (const block of message.content) {
      if (isToolUse(block) && block.id === toolUseId) {
        return block;
      }
    }
  }
  return null;
}

/**
 * Heuristic: did this filesystem result create a brand-new file? The
 * `file_write` tool annotates new-file writes with a `(new file, … )`
 * summary; edits never do. Used only to label the card ("created" vs
 * "updated"), so a false negative just downgrades the label.
 */
export function resultLooksLikeNewFile(content: string): boolean {
  return /\bnew file\b/i.test(content);
}

export function isToolUse(block: ContentBlock): block is ToolUseContent {
  return block.type === "tool_use";
}

export function getStringInput(
  input: Record<string, unknown>,
  key: string,
): string | null {
  const value = input[key];
  return typeof value === "string" ? value : null;
}
