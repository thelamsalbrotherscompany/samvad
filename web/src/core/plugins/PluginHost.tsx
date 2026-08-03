import { createContext, useContext, useEffect, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import type { Capability, PluginContext, SamvadPlugin, TileParticipant } from './types'

/**
 * Loads plugins and exposes what they register — nothing more. Each plugin's `setup`
 * receives a context built from *only* its declared capabilities (docs/PLUGINS.md §1):
 * a method it didn't ask for isn't attached, and a UI slot it didn't declare throws. The
 * host, not convention, is the boundary.
 *
 * This mounts with the call, so plugins set up and tear down with it. First-party plugins
 * run in-process here; sandboxing untrusted plugins in a Worker is a later step.
 */

type ToolbarControl = ComponentType
type TileOverlay = ComponentType<{ participant: TileParticipant }>
type StageOverlay = ComponentType

type Registrations = {
  toolbar: ToolbarControl[]
  tile: TileOverlay[]
  stage: StageOverlay[]
}

const EMPTY: Registrations = { toolbar: [], tile: [], stage: [] }

const SlotsContext = createContext<Registrations>(EMPTY)

export type PluginDataApi = {
  send: (topic: string, payload: unknown, opts?: { to?: string }) => void
  subscribe: (topic: string, handler: (payload: unknown, from: string) => void) => () => void
}

export function PluginHost({
  plugins,
  selfId,
  data,
  children,
}: {
  plugins: readonly SamvadPlugin[]
  /** The self participant id, so plugins can key local state to the self tile. */
  selfId: string
  data: PluginDataApi
  children: ReactNode
}) {
  const [slots, setSlots] = useState<Registrations>(EMPTY)

  useEffect(() => {
    const reg: Registrations = { toolbar: [], tile: [], stage: [] }
    const cleanups: Array<() => void> = []

    for (const plugin of plugins) {
      const caps = plugin.capabilities
      const dataCap = caps.find((c): c is Extract<Capability, { type: 'data' }> => c.type === 'data')
      const uiSlots = new Set(
        caps.filter((c): c is Extract<Capability, { type: 'ui' }> => c.type === 'ui').map((c) => c.slot),
      )

      const ctx: PluginContext = { selfId }

      if (dataCap) {
        // Namespaced by plugin id, so plugins can't read each other's traffic.
        const topic = `${plugin.id}/${dataCap.topic}`
        ctx.data = {
          send: (payload, opts) => data.send(topic, payload, opts),
          on: (handler) => {
            const off = data.subscribe(topic, handler)
            cleanups.push(off)
            return off
          },
        }
      }

      if (uiSlots.size > 0) {
        ctx.ui = {
          registerToolbarControl: (c) => {
            requireSlot(uiSlots, 'toolbar', plugin)
            reg.toolbar.push(c)
          },
          registerTileOverlay: (c) => {
            requireSlot(uiSlots, 'tile-overlay', plugin)
            reg.tile.push(c)
          },
          registerStageOverlay: (c) => {
            requireSlot(uiSlots, 'stage-overlay', plugin)
            reg.stage.push(c)
          },
        }
      }

      // setup is expected to be synchronous for first-party plugins (registrations must
      // land before the first paint); an async setup's late registrations won't show.
      try {
        void plugin.setup(ctx)
      } catch (e) {
        console.error(`[plugins] ${plugin.id} setup failed`, e)
      }
      if (plugin.teardown) cleanups.push(() => void plugin.teardown?.())
    }

    setSlots(reg)
    return () => {
      for (const c of cleanups) {
        try {
          c()
        } catch {
          // A misbehaving teardown must not block the others.
        }
      }
      setSlots(EMPTY)
    }
    // Plugins + wiring are stable for the host's lifetime; set up once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <SlotsContext.Provider value={slots}>{children}</SlotsContext.Provider>
}

function requireSlot(
  granted: Set<string>,
  slot: string,
  plugin: SamvadPlugin,
): void {
  if (!granted.has(slot)) {
    throw new Error(`[plugins] ${plugin.id} used the "${slot}" UI slot without declaring it`)
  }
}

/** Renders every plugin-contributed toolbar control (e.g. the reactions picker). */
export function PluginToolbar() {
  const { toolbar } = useContext(SlotsContext)
  return (
    <>
      {toolbar.map((Control, i) => (
        <Control key={i} />
      ))}
    </>
  )
}

/** Renders every plugin-contributed tile overlay for one participant (e.g. a reaction). */
export function PluginTileOverlay({ participant }: { participant: TileParticipant }) {
  const { tile } = useContext(SlotsContext)
  return (
    <>
      {tile.map((Overlay, i) => (
        <Overlay key={i} participant={participant} />
      ))}
    </>
  )
}

/** Renders every plugin-contributed stage overlay. */
export function PluginStageOverlay() {
  const { stage } = useContext(SlotsContext)
  return (
    <>
      {stage.map((Overlay, i) => (
        <Overlay key={i} />
      ))}
    </>
  )
}
