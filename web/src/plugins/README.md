# Plugins

First-party features built on the **public plugin API** — no privileged `core/` access.
They're the living proof that the API is adequate: if a real feature couldn't be written
here, the API would be wrong.

- **`reactions/`** — emoji reactions. `data` topic + `toolbar` + `tile-overlay` slots.
- **`chat/`** — in-call chat. `data` topic + `toolbar` slot (owns its own button, unread
  badge, and panel).

## Writing your own

See **[`docs/PLUGIN-AUTHORING.md`](../../../docs/PLUGIN-AUTHORING.md)** for the full guide
(a complete example, the API surface, and the rules). In short:

1. Add a folder here that default-exports a `SamvadPlugin` (see `web/src/core/plugins/types.ts`).
2. Import only `@/core/plugins/types` and `@/design/*` — never the transport, media, or signalling.
3. Register it in the `PLUGINS` array in `web/src/App.tsx`.

That's the whole loop.
