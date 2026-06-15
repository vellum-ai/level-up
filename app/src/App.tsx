import { useEffect, useMemo, useState } from "preact/hooks";

import type { CapabilityChange, HistoryEvent } from "./types.js";
import { fetchHistory } from "./vellum.js";

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly events: HistoryEvent[] };

/** Human label + accent class for each kind of change. */
const CHANGE_META: Record<
  CapabilityChange,
  { readonly label: string; readonly className: string }
> = {
  created: { label: "created", className: "badge badge-created" },
  updated: { label: "updated", className: "badge badge-updated" },
  deleted: { label: "deleted", className: "badge badge-deleted" },
};

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Count added/removed lines in a unified diff for the per-event stat line. */
function diffStat(diff: string | null): { added: number; removed: number } {
  if (diff === null) {
    return { added: 0, removed: 0 };
  }
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removed += 1;
    }
  }
  return { added, removed };
}

function DiffLine({ text }: { readonly text: string }): preact.JSX.Element {
  let tone = "diff-context";
  if (text.startsWith("+") && !text.startsWith("+++")) {
    tone = "diff-add";
  } else if (text.startsWith("-") && !text.startsWith("---")) {
    tone = "diff-del";
  } else if (text.startsWith("@@")) {
    tone = "diff-hunk";
  }
  return <div class={`diff-line ${tone}`}>{text === "" ? " " : text}</div>;
}

function EventDiff({ diff }: { readonly diff: string }): preact.JSX.Element {
  const lines = diff.split("\n");
  return (
    <pre class="diff">
      {lines.map((line, index) => (
        <DiffLine key={index} text={line} />
      ))}
    </pre>
  );
}

function EventCard({
  event,
}: {
  readonly event: HistoryEvent;
}): preact.JSX.Element {
  const change = CHANGE_META[event.change];
  const { added, removed } = diffStat(event.diff);
  return (
    <li class="event">
      <div class="event-head">
        <span class={change.className}>{change.label}</span>
        <span class="event-title">
          <span class="event-kind">{event.kind}</span>
          <span class="event-name">{event.name}</span>
          <span class="event-file">{event.file}</span>
        </span>
        <time class="event-time">{formatTimestamp(event.timestamp)}</time>
      </div>
      <div class="event-meta">
        <span class="event-tool">{event.tool}</span>
        {event.diff !== null && (added > 0 || removed > 0) ? (
          <span class="event-stat">
            <span class="stat-add">+{added}</span>
            <span class="stat-del">−{removed}</span>
          </span>
        ) : null}
      </div>
      {event.diff !== null ? <EventDiff diff={event.diff} /> : null}
    </li>
  );
}

function Empty(): preact.JSX.Element {
  return (
    <div class="placeholder">
      <h2>No level-ups yet</h2>
      <p>
        When the assistant improves one of its own skills or plugins, the edit
        shows up here as a git-style diff.
      </p>
    </div>
  );
}

export function App(): preact.JSX.Element {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    fetchHistory()
      .then((events) => {
        if (active) {
          setState({ status: "ready", events });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          const message =
            error instanceof Error ? error.message : "Failed to load history.";
          setState({ status: "error", message });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const total = state.status === "ready" ? state.events.length : 0;
  const capabilities = useMemo(() => {
    if (state.status !== "ready") {
      return 0;
    }
    return new Set(state.events.map((event) => `${event.kind}:${event.name}`))
      .size;
  }, [state]);

  return (
    <div class="page">
      <header class="masthead">
        <h1>Level Up</h1>
        <p class="tagline">
          A running history of the assistant improving its own skills and
          plugins.
        </p>
        {state.status === "ready" && total > 0 ? (
          <div class="summary">
            <span>{total} edits</span>
            <span class="dot">·</span>
            <span>{capabilities} capabilities</span>
          </div>
        ) : null}
      </header>

      {state.status === "loading" ? (
        <div class="placeholder">
          <p>Loading history…</p>
        </div>
      ) : null}

      {state.status === "error" ? (
        <div class="placeholder placeholder-error">
          <h2>Couldn’t load history</h2>
          <p>{state.message}</p>
        </div>
      ) : null}

      {state.status === "ready" ? (
        total === 0 ? (
          <Empty />
        ) : (
          <ol class="events">
            {state.events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </ol>
        )
      ) : null}
    </div>
  );
}
