import type { Capability, PluginNet, PluginStorage, SamvadPlugin } from './types'

/**
 * Builders for the capability-gated `storage` and `network` sub-APIs, shared by both hosts
 * (in-room {@link PluginHost} and the pre-join media host). Each returns `undefined` when the
 * plugin didn't declare the capability, so the host simply doesn't attach it.
 *
 * **Honest scope:** for the current *in-process* plugins these are a **convention and a
 * portability shim, not a security boundary** — a plugin still has ambient `fetch` /
 * `localStorage`, so gating here can't *prevent* misuse, only shape the API a well-behaved
 * plugin uses. The boundary becomes real only when untrusted plugins run in a Worker with
 * those globals removed (Phase 6). What this *does* enforce today: `storage` is namespaced
 * (no cross-plugin key collisions) and tab-lifetime, and `net` rejects undeclared origins.
 */

/** Namespaced, `sessionStorage`-backed storage — present only with the `storage` capability. */
export function makeStorage(plugin: SamvadPlugin): PluginStorage | undefined {
  if (!plugin.capabilities.some((c) => c.type === 'storage')) return undefined
  const prefix = `samvad:plugin:${plugin.id}:`
  return {
    get: (key) => {
      try {
        return sessionStorage.getItem(prefix + key)
      } catch {
        return null
      }
    },
    set: (key, value) => {
      try {
        sessionStorage.setItem(prefix + key, value)
      } catch {
        // Storage full or blocked — a plugin's persistence is best-effort, never fatal.
      }
    },
    remove: (key) => {
      try {
        sessionStorage.removeItem(prefix + key)
      } catch {
        // ignore
      }
    },
  }
}

/** Origin-restricted `fetch` — present only with a `network` capability, gated to its origins. */
export function makeNet(plugin: SamvadPlugin): PluginNet | undefined {
  const cap = plugin.capabilities.find(
    (c): c is Extract<Capability, { type: 'network' }> => c.type === 'network',
  )
  if (!cap) return undefined
  const allowed = new Set(cap.origins)
  return {
    fetch: (input, init) => {
      let origin: string
      try {
        origin = new URL(input, location.href).origin
      } catch {
        return Promise.reject(new Error(`[plugins] ${plugin.id}: invalid URL ${input}`))
      }
      if (!allowed.has(origin)) {
        return Promise.reject(
          new Error(`[plugins] ${plugin.id} may not reach ${origin} — declare it in its network capability`),
        )
      }
      return fetch(input, init)
    },
  }
}
