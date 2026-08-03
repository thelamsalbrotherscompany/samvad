import { useEffect, useRef } from 'react'

type AudioPeer = { id: string; stream?: MediaStream | null }

/**
 * Plays remote participants' audio, decoupled from the video tiles. Video elements
 * stay muted (so a tile never doubles the sound, and your own self-view never echoes);
 * all incoming voice comes from these hidden <audio> elements instead — which is why
 * audio keeps playing even when a peer's camera is off.
 *
 * `muted` here is the "mute speaker" / deafen state; `sinkId` routes output to the
 * chosen speaker where the browser supports it.
 */
export function RemoteAudio({
  peers,
  muted,
  sinkId,
}: {
  peers: AudioPeer[]
  muted: boolean
  sinkId: string | null
}) {
  return (
    <div aria-hidden className="sr-only">
      {peers.map(
        (p) => p.stream && <PeerAudio key={p.id} stream={p.stream} muted={muted} sinkId={sinkId} />,
      )}
    </div>
  )
}

function PeerAudio({
  stream,
  muted,
  sinkId,
}: {
  stream: MediaStream
  muted: boolean
  sinkId: string | null
}) {
  const ref = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el && el.srcObject !== stream) {
      el.srcObject = stream
      // Autoplay is allowed here — playback starts after the user's "Join" gesture.
      void el.play?.().catch(() => {})
    }
  }, [stream])

  useEffect(() => {
    const el = ref.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null
    if (el && sinkId && typeof el.setSinkId === 'function') {
      void el.setSinkId(sinkId).catch(() => {})
    }
  }, [sinkId])

  return <audio ref={ref} autoPlay muted={muted} />
}
