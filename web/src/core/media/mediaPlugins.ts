import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import type { Capability, PluginContext, SamvadPlugin, TrackTransform } from '@/core/plugins/types'
import { useSettingsRegistry } from '@/core/plugins/settingsRegistry'
import { makeNet, makeStorage } from '@/core/plugins/capabilityServices'

/**
 * The **media-plugin host**: the counterpart to {@link PluginHost} for the
 * `video-transform` / `audio-transform` capabilities (and the `settings` UI slot they lean
 * on). It's separate for one structural reason — local camera/mic exist *before* you're
 * admitted, so a background-blur plugin has to run during pre-join, whereas the in-room
 * `PluginHost` (chat, reactions) only mounts once you're in. This host runs at the app root
 * and drives a generic pipeline; the effect itself lives entirely in a plugin, so core owns
 * no blur/segmentation code (docs/PLUGINS.md §2, non-negotiable #7).
 *
 * A plugin registers a {@link TrackTransform} only while its effect is wanted and drops it
 * to turn off; with nothing registered the pipeline publishes the raw track untouched, so an
 * idle effect costs zero frames.
 */

type MediaRegistry = {
  video: TrackTransform | null
  audio: TrackTransform | null
  setVideo: (t: TrackTransform | null) => void
  setAudio: (t: TrackTransform | null) => void
}

const useMediaRegistry = create<MediaRegistry>((set) => ({
  video: null,
  audio: null,
  setVideo: (video) => set({ video }),
  setAudio: (audio) => set({ audio }),
}))

/**
 * Runs each media plugin's `setup` once, with a capability-gated context exposing only
 * `media.registerVideo/AudioTransform` (per its declared transforms) and
 * `ui.registerSettingsPanel` (per the `settings` slot). Everything else throws if touched,
 * mirroring {@link PluginHost}'s "attach only what's granted" rule.
 */
export function useMediaPlugins(plugins: readonly SamvadPlugin[]): void {
  useEffect(() => {
    const cleanups: Array<() => void> = []
    const registry = useMediaRegistry.getState()
    const settings = useSettingsRegistry.getState()

    for (const plugin of plugins) {
      const caps = plugin.capabilities
      const hasVideo = caps.some((c) => c.type === 'video-transform')
      const hasAudio = caps.some((c) => c.type === 'audio-transform')
      const uiSlots = new Set(
        caps.filter((c): c is Extract<Capability, { type: 'ui' }> => c.type === 'ui').map((c) => c.slot),
      )

      const ctx: PluginContext = { selfId: 'self', selfName: '' }

      const storage = makeStorage(plugin)
      if (storage) ctx.storage = storage
      const net = makeNet(plugin)
      if (net) ctx.net = net

      if (hasVideo || hasAudio) {
        ctx.media = {
          registerVideoTransform: (t) => registerTransform('video', hasVideo, plugin, t, registry, cleanups),
          registerAudioTransform: (t) => registerTransform('audio', hasAudio, plugin, t, registry, cleanups),
        }
      }

      if (uiSlots.size > 0) {
        ctx.ui = {
          registerToolbarControl: () => denySlot('toolbar', plugin),
          registerTileOverlay: () => denySlot('tile-overlay', plugin),
          registerStageOverlay: () => denySlot('stage-overlay', plugin),
          registerSettingsPanel: (component) => {
            if (!uiSlots.has('settings')) denySlot('settings', plugin)
            cleanups.push(settings.add(component))
          },
        }
      }

      try {
        void plugin.setup(ctx)
      } catch (e) {
        console.error(`[media-plugins] ${plugin.id} setup failed`, e)
      }
      if (plugin.teardown) cleanups.push(() => void plugin.teardown?.())
    }

    return () => {
      for (const c of cleanups) {
        try {
          c()
        } catch {
          // A misbehaving teardown must not block the others.
        }
      }
    }
  }, [plugins])
}

function registerTransform(
  kind: 'video' | 'audio',
  granted: boolean,
  plugin: SamvadPlugin,
  transform: TrackTransform,
  registry: MediaRegistry,
  cleanups: Array<() => void>,
): () => void {
  if (!granted) {
    throw new Error(`[media-plugins] ${plugin.id} registered a ${kind} transform it didn't declare`)
  }
  const set = kind === 'video' ? registry.setVideo : registry.setAudio
  const get = () => (kind === 'video' ? useMediaRegistry.getState().video : useMediaRegistry.getState().audio)
  set(transform)
  const off = () => {
    if (get() === transform) set(null)
  }
  cleanups.push(off)
  return off
}

function denySlot(slot: string, plugin: SamvadPlugin): never {
  throw new Error(
    `[media-plugins] ${plugin.id} used the "${slot}" UI slot — media plugins may use only "settings"`,
  )
}

/**
 * Applies the currently-registered video and audio transforms to the raw media, returning
 * the stream to publish and self-view. Nothing registered → the raw stream, untouched
 * (same identity, no processing). A registered transform's processed track replaces the raw
 * one; the two are managed independently so, e.g., toggling the camera never restarts audio.
 *
 * Video is gated by `cameraOn`; audio runs whenever a mic track is present. Each transform
 * returns its output track synchronously (video shows raw passthrough until any model
 * loads), so a swap is a single `replaceTrack`, never a black frame or an audio gap.
 */
export function useProcessedStream(raw: MediaStream | null, cameraOn: boolean): MediaStream | null {
  const videoTransform = useMediaRegistry((s) => s.video)
  const audioTransform = useMediaRegistry((s) => s.audio)
  // null on either means "publish the raw track for this kind".
  const [videoTrack, setVideoTrack] = useState<MediaStreamTrack | null>(null)
  const [audioTrack, setAudioTrack] = useState<MediaStreamTrack | null>(null)

  useEffect(() => {
    const src = raw?.getVideoTracks()[0] ?? null
    if (!raw || !cameraOn || !videoTransform || !src) {
      setVideoTrack(null)
      return
    }
    let cancelled = false
    setVideoTrack(null) // raw until the processed track exists (normally the same tick)
    Promise.resolve(videoTransform.start(src))
      .then((t) => {
        if (!cancelled) setVideoTrack(t)
      })
      .catch(() => {
        if (!cancelled) setVideoTrack(null) // failed to start — untouched camera
      })
    return () => {
      cancelled = true
      videoTransform.stop()
    }
  }, [raw, cameraOn, videoTransform])

  useEffect(() => {
    const src = raw?.getAudioTracks()[0] ?? null
    if (!raw || !audioTransform || !src) {
      setAudioTrack(null)
      return
    }
    let cancelled = false
    setAudioTrack(null)
    Promise.resolve(audioTransform.start(src))
      .then((t) => {
        if (!cancelled) setAudioTrack(t)
      })
      .catch(() => {
        if (!cancelled) setAudioTrack(null) // failed to start — untouched mic
      })
    return () => {
      cancelled = true
      audioTransform.stop()
    }
  }, [raw, audioTransform])

  return useMemo(() => {
    if (!raw) return raw
    if (!videoTrack && !audioTrack) return raw // nothing processed — pass raw through as-is
    const v = videoTrack ?? raw.getVideoTracks()[0]
    const a = audioTrack ?? raw.getAudioTracks()[0]
    return new MediaStream([v, a].filter(Boolean) as MediaStreamTrack[])
  }, [raw, videoTrack, audioTrack])
}
