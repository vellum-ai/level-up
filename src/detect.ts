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

/**
 * Managed-skill authoring tools, contributed by the host's `skill-management`
 * bundled skill and executed on the host. Unlike the filesystem tools above,
 * these mutate a skill through the managed-skill store
 * (`<workspace>/skills/<id>/SKILL.md`) rather than a path-bearing `file_write`,
 * so they never surface a path `classifyCapabilityPath` could match. We key on
 * the tool name and read the capability out of its structured input instead.
 */
export const MANAGED_SKILL_TOOL_NAMES: ReadonlySet<string> = new Set([
  "scaffold_managed_skill",
  "delete_managed_skill",
]);

/** A capability the assistant can edit and "level up". */
export type CapabilityKind = "skill" | "plugin";

/** How a capability changed this turn. Drives the card's per-change verb. */
export type CapabilityChange = "created" | "updated" | "deleted";

export interface CapabilityRef {
  readonly kind: CapabilityKind;
  /** Directory name of the skill/plugin, e.g. `"sanity"`. */
  readonly name: string;
  /** Path of the edited file relative to the capability root, e.g. `"SKILL.md"`. */
  readonly file: string;
}

/** A single recognized capability change: which capability, and how it changed. */
export interface CapabilityEdit {
  readonly ref: CapabilityRef;
  readonly change: CapabilityChange;
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

/**
 * Classify a managed-skill authoring tool call into a capability change.
 *
 * `scaffold_managed_skill` creates a skill, or updates it when `overwrite` is
 * set; `delete_managed_skill` removes it. Both identify the skill by its
 * `skill_id` input, and the managed store always writes the skill's top-level
 * `SKILL.md`, so that is the file we attribute the change to.
 *
 * Returns `null` for any other tool, or when the input lacks a usable
 * `skill_id`.
 */
export function classifyManagedSkillTool(
  toolName: string,
  input: Record<string, unknown>,
): CapabilityEdit | null {
  if (!MANAGED_SKILL_TOOL_NAMES.has(toolName)) {
    return null;
  }

  const skillId = getStringInput(input, "skill_id");
  if (skillId === null || skillId.trim() === "") {
    return null;
  }

  const ref: CapabilityRef = {
    kind: "skill",
    name: skillId.trim(),
    file: "SKILL.md",
  };

  if (toolName === "delete_managed_skill") {
    return { ref, change: "deleted" };
  }

  const change: CapabilityChange =
    input.overwrite === true ? "updated" : "created";
  return { ref, change };
}

/**
 * Recognize whether a successful tool result represents a change to one of the
 * assistant's own skills or plugins. Handles both the managed-skill authoring
 * tools (by tool name + input) and the generic filesystem tools (by edited
 * path), returning a single normalized {@link CapabilityEdit} either way.
 */
export function detectCapabilityEdit(
  toolUse: ToolUseContent,
  resultContent: string,
): CapabilityEdit | null {
  const managed = classifyManagedSkillTool(toolUse.name, toolUse.input);
  if (managed !== null) {
    return managed;
  }

  if (!EDIT_TOOL_NAMES.has(toolUse.name)) {
    return null;
  }

  const path = getStringInput(toolUse.input, "path");
  if (path === null) {
    return null;
  }

  const ref = classifyCapabilityPath(path);
  if (ref === null) {
    return null;
  }

  const change: CapabilityChange = resultLooksLikeNewFile(resultContent)
    ? "created"
    : "updated";
  return { ref, change };
}

export function getStringInput(
  input: Record<string, unknown>,
  key: string,
): string | null {
  const value = input[key];
  return typeof value === "string" ? value : null;
}
