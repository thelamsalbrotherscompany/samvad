import { useEffect, useState } from 'react'

/**
 * Real microphone level (0–1) from a live stream, via a Web Audio AnalyserNode.
 * Replaces the Phase-0 simulation. Returns 0 when there's no stream or `active`
 * is false (e.g. muted), so meters flatten cleanly.
 */
export function useAudioLevel(stream: MediaStream | null, active: boolean): number {
  const [level, setLevel] = useState(0)

  useEffect(() => {
    if (!stream || !active) {
      setLevel(0)
      return
    }
    const track = stream.getAudioTracks()[0]
    if (!track) {
      setLevel(0)
      return
    }

    let ctx: AudioContext
    try {
      ctx = new AudioContext()
    } catch {
      return
    }
    // Autoplay policy can start the context suspended; resume is a no-op otherwise.
    void ctx.resume()

    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)

    let raf = 0
    const tick = () => {
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / data.length)
      // Scale for typical speech; clamp to 1.
      setLevel(Math.min(1, rms * 3))
      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      source.disconnect()
      void ctx.close()
    }
  }, [stream, active])

  return level
}
