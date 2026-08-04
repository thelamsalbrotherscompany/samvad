import type { TrackTransform } from '@/core/plugins/types'

/**
 * A noise gate / downward expander for the mic, as an `audio-transform`. It cuts steady
 * background noise (fans, hum, hiss) by attenuating the mic when you're not speaking, and
 * high-passes out sub-voice rumble. Built from standard Web Audio nodes — no AudioWorklet —
 * so there's no worklet-bundling to go wrong:
 *
 *   mic ─► highpass(85Hz) ─► gain(gated) ─► destination ─► published track
 *                       └─► analyser (drives the gain)
 *
 * A short analyser loop measures RMS and rides the gain with a fast attack / gentle release
 * and hysteresis, so speech onsets aren't clipped and the floor fades rather than clicks.
 * "Closed" attenuates rather than hard-mutes, which sounds more natural than an on/off gate.
 * It complements — does not replace — the browser's built-in noise suppression.
 */

const OPEN_RMS = 0.03 // above this → treat as speech, open the gate
const CLOSE_RMS = 0.015 // below this → treat as silence, attenuate
const ATTACK_TC = 0.01 // fast, so a word's first syllable isn't swallowed
const RELEASE_TC = 0.12 // gentle, so the tail fades
const CLOSED_GAIN = 0.06 // floor when closed — an expander, not a hard mute

export class NoiseGateTransform implements TrackTransform {
  private ctx: AudioContext | null = null
  private gain: GainNode | null = null
  private analyser: AnalyserNode | null = null
  // Explicit ArrayBuffer backing so the type is Float32Array<ArrayBuffer>, which
  // getFloatTimeDomainData requires (TS 6 typed-array generics).
  private buf: Float32Array<ArrayBuffer> | null = null
  private timer: number | null = null
  private open = true
  private out: MediaStreamTrack | null = null

  start(input: MediaStreamTrack): MediaStreamTrack {
    const ctx = new AudioContext()
    void ctx.resume().catch(() => {})
    this.ctx = ctx

    const source = ctx.createMediaStreamSource(new MediaStream([input]))
    const highpass = ctx.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = 85 // strip low rumble/hum below the voice band
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    const gain = ctx.createGain()
    gain.gain.value = 1
    const dest = ctx.createMediaStreamDestination()

    source.connect(highpass)
    highpass.connect(analyser)
    highpass.connect(gain)
    gain.connect(dest)

    this.analyser = analyser
    this.gain = gain
    this.buf = new Float32Array(new ArrayBuffer(analyser.fftSize * 4))
    this.timer = window.setInterval(() => this.tick(), 25)

    const track = dest.stream.getAudioTracks()[0]
    this.out = track
    return track
  }

  private tick(): void {
    const { analyser, buf, gain, ctx } = this
    if (!analyser || !buf || !gain || !ctx) return
    analyser.getFloatTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    const rms = Math.sqrt(sum / buf.length)

    // Hysteresis: open above OPEN_RMS, close below CLOSE_RMS, hold in the gap.
    if (!this.open && rms > OPEN_RMS) this.open = true
    else if (this.open && rms < CLOSE_RMS) this.open = false

    const target = this.open ? 1 : CLOSED_GAIN
    const tc = this.open ? ATTACK_TC : RELEASE_TC
    gain.gain.setTargetAtTime(target, ctx.currentTime, tc)
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.out?.stop()
    this.out = null
    void this.ctx?.close().catch(() => {})
    this.ctx = null
    this.analyser = null
    this.gain = null
    this.buf = null
  }
}
