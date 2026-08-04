import type { ComponentType } from 'react'

/**
 * The public plugin contract (docs/PLUGINS.md §1). First-party features are built on
 * exactly this surface — no privileged imports from core — so the API stays honest: if a
 * real feature can't be written through it, the API is wrong and the fix is the API.
 *
 * Most of the documented contract is wired: `data`, `ui` (toolbar / tile-overlay /
 * stage-overlay / settings), and `video-transform` / `audio-transform` (via a media-plugin
 * host that runs from pre-join, since local media exists before you're admitted). `storage`
 * and `network` are part of the type (so manifests are forward-compatible) but not yet
 * enforced, `lifecycle` is not yet delivered, and untrusted plugins do not yet run in a
 * Worker sandbox. First-party, in-process plugins that use only this API are the target.
 */

export const SAMVAD_PLUGIN_API = '0.1.0'

export type UiSlot = 'toolbar' | 'sidebar' | 'stage-overlay' | 'tile-overlay' | 'settings'

export type Capability =
  | { type: 'video-transform' }
  | { type: 'audio-transform' }
  | { type: 'ui'; slot: UiSlot }
  | { type: 'data'; topic: string }
  | { type: 'lifecycle' }
  | { type: 'storage' }
  | { type: 'network'; origins: readonly string[] }

export interface SamvadPlugin {
  readonly id: string // reverse-DNS, e.g. "org.samvad.reactions"
  readonly name: string
  readonly version: string // semver
  readonly author?: string
  /** Requested up front, immutable. The host grants exactly what's listed, nothing more. */
  readonly capabilities: readonly Capability[]
  setup(ctx: PluginContext): void | Promise<void>
  teardown?(): void | Promise<void>
}

/** The minimal participant shape a tile-overlay plugin sees — never the core Participant. */
export type TileParticipant = {
  id: string
  name: string
  isSelf: boolean
}

/** Options when registering a media-track transform. Lower `order` runs first (reserved). */
export type TransformOptions = { order?: number }

/**
 * A media-track transform: given the raw camera (or mic) track, return a processed one.
 * Backs both the `video-transform` and `audio-transform` capabilities. The plugin owns the
 * whole pipeline and may run a Web Worker internally; the host just publishes the returned
 * track in place of the raw one. Register only while the effect is actually wanted and
 * unregister to turn it off — the host reverts to the raw track when nothing is registered,
 * so an idle plugin costs nothing.
 */
export interface TrackTransform {
  /**
   * Begin processing `input` and return the track to publish. Return synchronously so there's
   * no gap; if a model must load, show raw passthrough on the returned track until it's ready.
   */
  start(input: MediaStreamTrack): MediaStreamTrack | Promise<MediaStreamTrack>
  /** Stop and release everything. The host reverts to the raw track. */
  stop(): void
}

/** A room lifecycle event a plugin can observe (with the `lifecycle` capability). */
export type LifecycleEvent =
  | { type: 'joined'; id: string; name: string }
  | { type: 'left'; id: string; name: string }

/**
 * What a plugin's `setup` receives. Every method is capability-gated: calling one the
 * plugin didn't declare throws. Only granted sub-APIs are attached.
 */
export interface PluginContext {
  /** This client's own participant id — matches the self tile, for keying local state. */
  readonly selfId: string
  /** This client's display name — so a plugin can label its own outgoing messages. */
  readonly selfName: string

  /** Present iff the plugin declared a `data` capability. E2EE, on the plugin's topic. */
  data?: {
    /** Broadcast to the room, or to one peer. Rides the same encrypted channel as media. */
    send(payload: unknown, opts?: { to?: string }): void
    /** Subscribe to messages on this plugin's topic. Returns an unsubscribe fn. */
    on(handler: (payload: unknown, from: string) => void): () => void
  }

  /** Present iff the plugin declared at least one `ui` capability. Slot-gated per method. */
  ui?: {
    registerToolbarControl(component: ComponentType): void
    registerTileOverlay(component: ComponentType<{ participant: TileParticipant }>): void
    registerStageOverlay(component: ComponentType): void
    /** Contribute a section to the Settings dialog (needs the `settings` UI slot). */
    registerSettingsPanel(component: ComponentType): void
  }

  /**
   * Present iff the plugin declared a `video-transform` and/or `audio-transform` capability.
   * Registering returns an unregister fn — call it to turn the effect off (the host then
   * publishes the raw track again).
   */
  media?: {
    /** Transform the local camera track (needs `video-transform`). Returns an unregister fn. */
    registerVideoTransform(transform: TrackTransform, opts?: TransformOptions): () => void
    /** Transform the local mic track (needs `audio-transform`). Returns an unregister fn. */
    registerAudioTransform(transform: TrackTransform, opts?: TransformOptions): () => void
  }

  /** Present iff the plugin declared a `lifecycle` capability. */
  lifecycle?: {
    on(handler: (event: LifecycleEvent) => void): () => void
  }
}
