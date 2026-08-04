import { create } from 'zustand'
import type { ComponentType } from 'react'

/**
 * A tiny module-level registry for plugin-contributed Settings panels (the `settings` UI
 * slot). Unlike the toolbar/tile/stage slots — which live in {@link PluginHost}'s React
 * context and only exist inside the room — settings must be reachable from the Settings
 * dialog, which is mounted above the room (it opens during pre-join too). A module store
 * sidesteps the tree-position problem: any component reads it via {@link useSettingsPanels},
 * and either host (the in-room one or the pre-join media host) can contribute to it.
 *
 * `add` returns an unregister fn so a host can drop a plugin's panel on teardown.
 */

type Panel = { id: number; component: ComponentType }

type SettingsRegistry = {
  panels: Panel[]
  add: (component: ComponentType) => () => void
}

let seq = 0

export const useSettingsRegistry = create<SettingsRegistry>((set) => ({
  panels: [],
  add: (component) => {
    const id = (seq += 1)
    set((s) => ({ panels: [...s.panels, { id, component }] }))
    return () => set((s) => ({ panels: s.panels.filter((p) => p.id !== id) }))
  },
}))

/** The registered Settings panels, in registration order. */
export function useSettingsPanels(): ComponentType[] {
  return useSettingsRegistry((s) => s.panels).map((p) => p.component)
}
