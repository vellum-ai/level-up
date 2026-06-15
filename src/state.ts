/**
 * In-process accumulator of pending skill/plugin changes, keyed by
 * conversation.
 *
 * The `post-tool-use` hook records each capability edit as the turn runs;
 * the `post-model-call` hook reads the batch to build a single "Level Up"
 * card and the `stop` hook drains it at the turn boundary. State is
 * intentionally ephemeral — a batch only needs to live across one turn, so it
 * is never persisted. If the daemon restarts mid-turn the pending batch is
 * lost, which is acceptable for a best-effort, after-the-fact summary (the
 * durable history log in `history.ts` is the source of truth).
 */

import type {
  CapabilityChange,
  CapabilityKind,
  CapabilityRef,
} from "./detect.js";

/** Accumulated changes to a single capability within one turn. */
export interface PendingCapability {
  readonly kind: CapabilityKind;
  readonly name: string;
  /** Files touched this turn, in first-seen order, de-duplicated. */
  readonly files: string[];
  /** The net change to this capability across the turn's edits. */
  change: CapabilityChange;
  /**
   * Unified-diff text of the most recent diff-bearing edit to this capability
   * this turn, used to render a compact preview in the card. `null` when no
   * edit surfaced a diff (e.g. a `file_write` or a managed-skill tool).
   */
  diff: string | null;
}

/**
 * Reduce two changes to the same capability within one turn to the most
 * representative final label. A deletion is the terminal state, so it wins;
 * otherwise a creation outranks a plain update.
 */
function mergeChange(
  current: CapabilityChange,
  next: CapabilityChange,
): CapabilityChange {
  if (current === "deleted" || next === "deleted") {
    return "deleted";
  }
  if (current === "created" || next === "created") {
    return "created";
  }
  return "updated";
}

interface ConversationBatch {
  /** Pending capabilities keyed by `"<kind>:<name>"`. */
  readonly byKey: Map<string, PendingCapability>;
  /**
   * Whether the model has already been nudged (via `additionalContext`) to
   * render the card for the current batch. Prevents re-nudging on every
   * subsequent edit in the same turn.
   */
  nudged: boolean;
}

const batches = new Map<string, ConversationBatch>();

function capabilityKey(kind: CapabilityKind, name: string): string {
  return `${kind}:${name}`;
}

export interface RecordResult {
  /**
   * True when this edit opened a fresh batch for the conversation (the model
   * has not yet been nudged). The caller uses this to decide whether to emit
   * the inline `additionalContext` nudge.
   */
  readonly shouldNudge: boolean;
}

/**
 * Record a capability edit for a conversation. Merges repeated edits to the
 * same capability (collecting distinct files) so several edits to one
 * `SKILL.md` collapse into a single card section.
 */
export function recordCapabilityEdit(
  conversationId: string,
  ref: CapabilityRef,
  change: CapabilityChange,
  diff: string | null = null,
): RecordResult {
  let batch = batches.get(conversationId);
  if (batch === undefined) {
    batch = { byKey: new Map(), nudged: false };
    batches.set(conversationId, batch);
  }

  const key = capabilityKey(ref.kind, ref.name);
  const existing = batch.byKey.get(key);
  if (existing === undefined) {
    batch.byKey.set(key, {
      kind: ref.kind,
      name: ref.name,
      files: [ref.file],
      change,
      diff,
    });
  } else {
    if (!existing.files.includes(ref.file)) {
      existing.files.push(ref.file);
    }
    existing.change = mergeChange(existing.change, change);
    // Keep the newest diff-bearing edit; a later diffless edit (e.g. a
    // `file_write`) does not erase a preview captured from an earlier one.
    if (diff !== null) {
      existing.diff = diff;
    }
  }

  const shouldNudge = !batch.nudged;
  batch.nudged = true;
  return { shouldNudge };
}

/** Snapshot the pending capabilities for a conversation (never mutated by callers). */
export function getPendingCapabilities(
  conversationId: string,
): PendingCapability[] {
  const batch = batches.get(conversationId);
  return batch === undefined ? [] : [...batch.byKey.values()];
}

export function hasPendingCapabilities(conversationId: string): boolean {
  const batch = batches.get(conversationId);
  return batch !== undefined && batch.byKey.size > 0;
}

/** Drop the batch for a conversation once it has been surfaced (or abandoned). */
export function clearPendingCapabilities(conversationId: string): void {
  batches.delete(conversationId);
}

/** Test-only: wipe all in-process state between cases. */
export function __resetForTests(): void {
  batches.clear();
}
