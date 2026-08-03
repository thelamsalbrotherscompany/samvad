import { useEffect, useRef, useState } from 'react'

type Source = { id: string; stream: MediaStream | null }

// RMS (0..1) above which a source counts as talking.
const SPEAK_THRESHOLD = 0.045
// A new speaker must be this much louder than the current one to steal the focus.
const SWITCH_MARGIN = 1.25
const POLL_MS = 120

/**
 * Real active-speaker + voice-activity detection from live audio.
 *
 * Each source is tapped with a WebAudio AnalyserNode — read-only, never connected to the
 * output, so it doesn't double the sound — and its RMS energy is measured. Returns who is
 * currently talking (for the speaking rings) and the dominant *remote* speaker (for the
 * featured tile). Self is measured for its own ring but never featured — you don't
 * spotlight yourself, matching every major client.
 *
 * The dominant speaker is sticky: it holds through short pauses and only switches when
 * someone else is clearly ({@link SWITCH_MARGIN}) louder, so the stage doesn't flip on
 * every syllable or bit of cross-talk.
 */
export function useActiveSpeaker(
  sources: Source[],
  selfId = 'self',
): { speakingIds: Set<string>; dominantId: string | null } {
  const [speakingIds, setSpeakingIds] = useState<Set<string>>(() => new Set())
  const [dominantId, setDominantId] = useState<string | null>(null)
  const dominantRef = useRef<string | null>(null)

  // Signature of the live audio graph — rebuild only when the set of streams changes,
  // not on every render (sources is a fresh array each time).
  const withAudio = sources.filter((s) => s.stream && s.stream.getAudioTracks().length > 0)
  const sig = withAudio
    .map((s) => `${s.id}:${(s.stream as MediaStream).id}`)
    .sort()
    .join(',')

  useEffect(() => {
    if (withAudio.length === 0) {
      setSpeakingIds(new Set())
      setDominantId(null)
      dominantRef.current = null
      return
    }

    let ctx: AudioContext
    try {
      ctx = new AudioContext()
    } catch {
      return
    }
    void ctx.resume()

    const nodes = withAudio.map((s) => {
      const src = ctx.createMediaStreamSource(s.stream as MediaStream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.3
      src.connect(analyser)
      return { id: s.id, analyser, data: new Uint8Array(analyser.fftSize) }
    })

    let prevSpeakingSig = ''

    const tick = () => {
      const speaking: string[] = []
      let loudRemoteId: string | null = null
      let loudRemoteRms = 0
      let currentDominantRms = 0

      for (const n of nodes) {
        n.analyser.getByteTimeDomainData(n.data)
        let sum = 0
        for (let i = 0; i < n.data.length; i++) {
          const v = (n.data[i] - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / n.data.length)
        if (rms > SPEAK_THRESHOLD) speaking.push(n.id)
        if (n.id !== selfId && rms > loudRemoteRms) {
          loudRemoteRms = rms
          loudRemoteId = n.id
        }
        if (n.id === dominantRef.current) currentDominantRms = rms
      }

      // Sticky dominant: keep the current speaker through pauses; switch only when a
      // different remote is clearly louder, or the current one has gone quiet.
      let next = dominantRef.current
      const currentSpeaking = currentDominantRms > SPEAK_THRESHOLD
      if (loudRemoteId && loudRemoteRms > SPEAK_THRESHOLD) {
        if (
          next === null ||
          !currentSpeaking ||
          (loudRemoteId !== next && loudRemoteRms > currentDominantRms * SWITCH_MARGIN)
        ) {
          next = loudRemoteId
        }
      }
      if (next && !nodes.some((n) => n.id === next)) next = null

      if (next !== dominantRef.current) {
        dominantRef.current = next
        setDominantId(next)
      }

      const nextSig = speaking.slice().sort().join(',')
      if (nextSig !== prevSpeakingSig) {
        prevSpeakingSig = nextSig
        setSpeakingIds(new Set(speaking))
      }
    }

    const timer = setInterval(tick, POLL_MS)
    return () => {
      clearInterval(timer)
      for (const n of nodes) n.analyser.disconnect()
      void ctx.close()
    }
    // Rebuilt only when the stream set changes; `withAudio` is derived from `sig`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, selfId])

  return { speakingIds, dominantId }
}
