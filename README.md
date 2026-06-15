# level-up

A [Vellum Assistant](https://github.com/vellum-ai/vellum-assistant) plugin that
surfaces a **first-class "Level Up" card** whenever the assistant edits its own
**skills** or **plugins** — so you can see, after the fact, exactly how it
improved itself and why.

When the assistant durably updates a `SKILL.md`, a plugin hook, or a manifest in
response to feedback or a mistake (procedural self-improvement), that change is
otherwise just another file-edit in the tool log. `level-up` recognizes those
edits and shows them as a dedicated before/after diff card in the chat.

## How it works

The plugin contributes lifecycle hooks (no host changes required) plus a
bundled, multifile app it installs into the workspace. It records every
self-edit to a durable log — the source of truth — and drives the host's
built-in `ui_show` tool to render a compact, after-the-fact preview that links
to the app for the full history.

1. **`init`** — fires once at daemon startup. It wires the durable history
   module to the plugin's writable data directory, upserts the bundled
   **Level Up app** (a formatVersion-2 multifile TSX app) into
   `<workspace>/data/apps`, and installs the route handler
   (`<workspace>/routes/level-up.ts`) that serves the history at
   `GET /v1/x/level-up`. App source is written only — the host compiles
   `dist/` on first open — and seeding is idempotent.
2. **`post-tool-use`** — fires after every tool result. It identifies changes
   to the assistant's own capabilities, **durably appends each one** (with its
   diff text, when the tool surfaces one) to the history log the app reads, and
   accumulates them into a per-turn batch (one entry per capability, collecting
   every file touched). Two kinds of change are recognized:
   - **Filesystem edits** (`file_edit` / `file_write` and their `host_*` twins)
     whose target lives under `skills/<name>/…` or `plugins/<name>/…`.
   - **Managed-skill authoring tools** (`scaffold_managed_skill` /
     `delete_managed_skill`, contributed by the host's `skill-management`
     bundled skill). These write a skill's `SKILL.md` through the managed-skill
     store rather than a path-bearing `file_write`, so they're matched by tool
     name and the capability is read from the `skill_id` input. This is how the
     assistant creates/updates/deletes skills in normal use, so without it the
     most common self-improvement path would go unnoticed.

   On the first change of a batch it appends a model-only `additionalContext`
   nudge asking the model to render a Level Up card before it ends the turn.
3. **`post-model-call`** — the deterministic backstop. It is the only hook the
   agent loop lets continue the turn (`StopContext` is terminal and read-only).
   When a user-facing, no-tool reply lands with a skill/plugin still pending and
   no `ui_show` card rendered, it appends a fully-specified nudge and forces
   exactly one more loop iteration so the card is rendered. A one-shot guard
   ensures a non-compliant model can never spin the loop.
4. **`stop`** — fires at the terminal boundary. Its sole job is to drain the
   conversation's pending batch and forced-render mark so the next turn starts
   clean.

The card is the host's `ui_show` `work_result` surface with `diff` sections and
a link to the bundled app at `/assistant/library/level-up`:

```jsonc
{
  "surface_type": "work_result",
  "title": "Level up",
  "data": {
    "eyebrow": "Self-improvement",
    "status": "completed",
    "summary": "Learned that publishing via the Sanity API is the publish.",
    "sections": [
      {
        "title": "sanity (skill)",
        "type": "diff",
        "diffs": [{ "label": "SKILL.md", "before": "…", "after": "…" }]
      }
    ]
  }
}
```

## Design notes

- **The history log is the source of truth.** `post-tool-use` records every
  self-edit to `<workspace>/plugins-data/level-up/history.json` regardless of
  whether the model renders a card, so the app's history is durable and
  complete. The inline card is a best-effort, after-the-fact preview.
- **The card is model-rendered.** The before/after diff shown in the card is the
  model's reconstruction of its own edits from its context, not a byte-exact
  diff. The full, byte-accurate diff text lives in the history log and is shown
  in the app.
- **Forced render lives in `post-model-call`, not `stop`.** The terminal `stop`
  hook's `messages` are read-only and it carries no `decision`, so it cannot
  continue the turn; `post-model-call` is the only boundary the loop honors a
  `continue` from.

Per-turn batch state is intentionally in-process and ephemeral; only the history
log is persisted.

## Layout

```
hooks/init.ts            wire history dir; upsert app + route handler (idempotent)
hooks/post-tool-use.ts   detect skill/plugin edits, append history, accumulate, nudge
hooks/post-model-call.ts deterministic backstop that forces the card to render
hooks/stop.ts            drain the per-turn batch at the boundary
src/detect.ts            pure path/result classification + diff extraction
src/history.ts           durable, append-only edit log (the app's data source)
src/state.ts             per-conversation pending-change accumulator
src/nudge.ts             builds the ui_show instructions; card-already-shown check
routes/level-up.ts       serves the history at GET /v1/x/level-up
app/src/                 the bundled formatVersion-2 Level Up history app
```

## Development

```bash
bun install
bun run typecheck   # tsc --noEmit
bun test            # runs __tests__/*.test.ts
```

Types come from the published [`@vellumai/plugin-api`](https://www.npmjs.com/package/@vellumai/plugin-api)
package (a devDependency, pinned to the version this plugin targets). The host
provides the runtime implementation at load time; the npm package supplies the
type definitions so the repo type-checks and tests in isolation.
