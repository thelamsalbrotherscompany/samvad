import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'

type Props = {
  stream: MediaStream
  className?: string
  style?: CSSProperties
  /** Always true for self-view (no echo); remote audio plays elsewhere. */
  muted?: boolean
  /** Accessible name for the video (e.g. "Sangam's camera"), so it isn't an unnamed region. */
  label?: string
}

/**
 * Binds a MediaStream to a <video> element. `srcObject` can't be set via JSX, so it's
 * assigned imperatively. Always muted + playsInline + autoPlay for a call surface.
 */
export function VideoView({ stream, className, style, muted = true, label }: Props) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el && el.srcObject !== stream) el.srcObject = stream
  }, [stream])

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      aria-label={label}
      className={className}
      style={style}
    />
  )
}
