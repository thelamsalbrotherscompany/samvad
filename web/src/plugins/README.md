# Plugins

First-party features built on the **public plugin API** — no privileged `core/` access.
They're the living proof that the API is adequate: if a real feature couldn't be written
here, the API would be wrong.

- **`reactions/`** — emoji reactions. `data` topic + `toolbar` + `tile-overlay` slots.
- **`chat/`** — in-call chat. `data` topic + `toolbar` slot (owns its own button, unread
  badge, and panel).
- **`background/`** — background blur / image replace / bundled gradients. `video-transform`
  (MediaPipe segmentation in a Web Worker) + the `settings` slot.
- **`noise/`** — a mic noise gate. `audio-transform` (Web Audio) + the `settings` slot.

`reactions` and `chat` are **in-room** plugins (registered in `PLUGINS`); `background` and
`noise` are **media** plugins (registered in `MEDIA_PLUGINS`), so they run from pre-join —
see the two arrays in `web/src/App.tsx`.

## Writing your own

See **[`docs/PLUGIN-AUTHORING.md`](../../../docs/PLUGIN-AUTHORING.md)** for the full guide
(a complete example, the API surface, and the rules). In short:

1. Add a folder here that default-exports a `SamvadPlugin` (see `web/src/core/plugins/types.ts`).
2. Import only `@/core/plugins/types` and `@/design/*` — never the transport, media, or signalling.
3. Register it in `web/src/App.tsx`: `PLUGINS` for a data/UI plugin, or `MEDIA_PLUGINS` for a
   `video`/`audio-transform` plugin.

That's the whole loop.
