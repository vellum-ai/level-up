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

This is a **model-driven** implementation (no host changes required). The plugin
contributes two lifecycle hooks and no UI surface of its own — it drives the
host's built-in `ui_show` tool to render the card.

1. **`post-tool-use`** — fires after every tool result. It identifies changes
   to the assistant's own capabilities and accumulates them into a per-turn
   batch (one entry per capability, collecting every file touched). Two kinds of
   change are recognized:
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
2. **`stop`** — fires at the turn boundary. If the turn touched a skill/plugin
   and the model has **not** already rendered a `ui_show` card on its own, it
   appends a fully-specified nudge and forces one more loop iteration so the
   card is rendered after the fact. The batch is then drained.

The card is the host's `ui_show` `work_result` surface with `diff` sections:

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

## Design notes & limitations

This is the lightweight, ships-today path. Because the card is rendered by the
**model** from the edit contents in its context (rather than from the structured
`DiffInfo` the file tools already produce), it has two inherent trade-offs:

- **Best-effort fidelity.** The before/after shown is the model's reconstruction
  of its own edits, not a byte-exact diff captured by the host.
- **Best-effort triggering.** The `stop` backstop makes rendering reliable, but a
  deterministic, byte-exact card would require a small host primitive that lets a
  `post-tool-use` hook read `ctx.toolResponse`'s structured `diff` and emit a
  client surface directly. That is the natural follow-up if this proves useful.

State is intentionally in-process and ephemeral — a batch only needs to live for
one turn, so nothing is persisted.

## Layout

```
hooks/post-tool-use.ts   detect skill/plugin edits, accumulate, nudge
hooks/stop.ts            backstop that guarantees the card renders
src/detect.ts            pure path/result classification
src/state.ts             per-conversation pending-change accumulator
src/nudge.ts             builds the ui_show instructions; card-already-shown check
```

## Development

```bash
bun install
bun run typecheck   # tsc --noEmit
bun test            # runs __tests__/*.test.ts
```

`@vellumai/plugin-api` is provided by the host at load time and is not published
to npm; `types/vellumai-plugin-api.d.ts` is a local ambient declaration of the
subset this plugin uses so the repo type-checks and tests in isolation.
