/**
 * Builds the synthetic `ui_show` tool call that renders the "Level Up" card.
 *
 * The `post-model-call` hook appends the returned block to the finalized
 * assistant reply; the host then runs it through the normal tool executor (as
 * if the model had called `ui_show` itself), so the card streams in as a
 * surface after any prose the model already produced. The card is a compact,
 * git-style preview of this turn's self-edits plus a link to the bundled
 * Level Up app, which holds the full diff history.
 */

import type { ToolUseContent } from "@vellumai/plugin-api";

import { LEVEL_UP_APP_HREF } from "./nudge.js";
import type { PendingCapability } from "./state.js";

/** Past-tense verb shown for each capability's change. */
const CHANGE_VERB: Record<PendingCapability["change"], string> = {
  created: "Created",
  updated: "Updated",
  deleted: "Deleted",
};

/** Max lines kept on each side of a reconstructed diff preview. */
const MAX_PREVIEW_LINES = 6;

/** A unified-diff metadata line (hunk/file header), not added/removed content. */
function isDiffMetaLine(line: string): boolean {
  return (
    line.startsWith("@@") ||
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ")
  );
}

function clampLines(lines: string[], max: number): string {
  if (lines.length <= max) {
    return lines.join("\n");
  }
  return [...lines.slice(0, max), "…"].join("\n");
}

/**
 * Reconstruct compact before/after text from unified-diff hunk text. Context
 * lines land on both sides; `-` lines on the before side, `+` lines on the
 * after side. Each side is clamped to a few lines so the card stays a preview,
 * not the whole file.
 */
export function reconstructDiffPreview(diff: string): {
  before: string;
  after: string;
} {
  const before: string[] = [];
  const after: string[] = [];
  for (const line of diff.split("\n")) {
    if (isDiffMetaLine(line)) {
      continue;
    }
    if (line.startsWith("+")) {
      after.push(line.slice(1));
    } else if (line.startsWith("-")) {
      before.push(line.slice(1));
    } else {
      const context = line.startsWith(" ") ? line.slice(1) : line;
      before.push(context);
      after.push(context);
    }
  }
  return {
    before: clampLines(before, MAX_PREVIEW_LINES),
    after: clampLines(after, MAX_PREVIEW_LINES),
  };
}

function summarize(capabilities: ReadonlyArray<PendingCapability>): string {
  const [first] = capabilities;
  if (capabilities.length === 1 && first !== undefined) {
    return `${CHANGE_VERB[first.change]} the "${first.name}" ${first.kind}.`;
  }
  return `Improved ${capabilities.length} capabilities this turn.`;
}

function capabilitySection(cap: PendingCapability): Record<string, unknown> {
  const base = {
    title: `${cap.name} (${cap.kind})`,
    description: `${CHANGE_VERB[cap.change]} ${cap.files.join(", ")}`,
  };
  if (cap.diff === null) {
    return base;
  }
  const { before, after } = reconstructDiffPreview(cap.diff);
  return {
    ...base,
    type: "diff",
    diffs: [{ label: cap.files[0] ?? cap.name, before, after }],
  };
}

/**
 * Build the `ui_show` tool-use block for the current batch of self-edits. The
 * `id` is left empty for the host to backfill when it adopts the finalized
 * content. Caller guarantees `capabilities` is non-empty.
 */
export function buildLevelUpToolUse(
  capabilities: ReadonlyArray<PendingCapability>,
): ToolUseContent {
  const sections: Array<Record<string, unknown>> = capabilities.map(
    capabilitySection,
  );
  sections.push({
    type: "items",
    items: [
      {
        title: "Open Level Up",
        description: "See the full diff history",
        href: LEVEL_UP_APP_HREF,
      },
    ],
  });

  return {
    type: "tool_use",
    id: "",
    name: "ui_show",
    input: {
      surface_type: "work_result",
      title: "Level up",
      display: "inline",
      data: {
        eyebrow: "Self-improvement",
        status: "completed",
        summary: summarize(capabilities),
        sections,
      },
    },
  };
}
