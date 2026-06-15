/**
 * Shape of the durable history the plugin records and this app renders.
 *
 * Mirrors the `HistoryEvent` / `HistoryFile` types the plugin writes in
 * `src/history.ts`. Kept as an independent declaration (rather than imported)
 * because the app is compiled in isolation by the host bundler and has no
 * path back into the plugin's `src/`.
 */

export type CapabilityKind = "skill" | "plugin";
export type CapabilityChange = "created" | "updated" | "deleted";

/** A single recorded self-improvement edit. */
export interface HistoryEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly conversationId: string;
  readonly kind: CapabilityKind;
  readonly name: string;
  readonly file: string;
  readonly change: CapabilityChange;
  readonly tool: string;
  readonly diff: string | null;
}

/** The envelope returned by `GET /v1/x/level-up`. */
export interface HistoryFile {
  readonly version: number;
  readonly events: HistoryEvent[];
}
