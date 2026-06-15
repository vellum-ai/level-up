/**
 * In-process accumulator of pending skill/plugin changes, keyed by
 * conversation.
 *
 * The `post-tool-use` hook records each capability edit as the turn runs;
 * the `post-model-call` hook reads the batch to drive a single "Level Up"
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
    });
  } else {
    if (!existing.files.includes(ref.file)) {
      existing.files.push(ref.file);
    }
    existing.change = mergeChange(existing.change, change);
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

/**
 * Conversations for which `post-model-call` has already injected one forced
 * render. Separate from the per-batch `nudged` flag: the inline nudge is
 * advisory and may be ignored, whereas this guards the single `continue`
 * re-prompt so a non-compliant model can never trigger an unbounded loop.
 */
const forcedRender = new Set<string>();

/**
 * Mark that a forced render has been requested for this conversation. Returns
 * `true` when this is the first request (caller should proceed with the
 * `continue`), `false` when one was already issued (caller must not loop).
 */
export function markForcedRender(conversationId: string): boolean {
  if (forcedRender.has(conversationId)) {
    return false;
  }
  forcedRender.add(conversationId);
  return true;
}

/** Clear the forced-render mark at the turn boundary. */
export function clearForcedRender(conversationId: string): void {
  forcedRender.delete(conversationId);
}

/** Test-only: wipe all in-process state between cases. */
export function __resetForTests(): void {
  batches.clear();
  forcedRender.clear();
}
