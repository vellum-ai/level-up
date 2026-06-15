/**
 * Typed access to the `window.vellum` bridge the host injects into the app
 * iframe, plus the single data fetch this app makes.
 *
 * The bridge is only present when the app runs inside the host surface (it is
 * injected at render time). `fetchHistory` therefore degrades gracefully when
 * the bridge or route is unavailable so the app can render an empty/error
 * state instead of throwing.
 */

import type { HistoryEvent, HistoryFile } from "./types.js";

/** The custom-route path the plugin's `routes/level-up.ts` handler serves. */
export const HISTORY_ROUTE = "/v1/x/level-up";

/** A fetch-like response, as resolved by the host bridge's `fetch`. */
interface VellumResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

interface VellumBridge {
  fetch?(path: string, options?: RequestInit): Promise<VellumResponse>;
}

declare global {
  interface Window {
    vellum?: VellumBridge;
  }
}

function isHistoryFile(value: unknown): value is HistoryFile {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { events?: unknown }).events)
  );
}

/**
 * Fetch the durable self-improvement history from the plugin's custom route.
 * Returns the events newest-first. Throws a descriptive error the caller can
 * surface; never returns partial/garbage data.
 */
export async function fetchHistory(): Promise<HistoryEvent[]> {
  const bridge = window.vellum;
  if (bridge?.fetch === undefined) {
    throw new Error(
      "This page must be opened from inside Vellum to load its history.",
    );
  }

  const response = await bridge.fetch(HISTORY_ROUTE);
  if (!response.ok) {
    throw new Error(`Could not load history (status ${response.status}).`);
  }

  const payload = await response.json();
  if (!isHistoryFile(payload)) {
    throw new Error("History response was not in the expected format.");
  }

  return [...payload.events].reverse();
}
