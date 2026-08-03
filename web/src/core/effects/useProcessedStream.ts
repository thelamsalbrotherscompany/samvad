import { useEffect, useRef, useState } from 'react'
import type { Background } from '@/lib/settings'
import { BackgroundEffect } from './backgroundEffect'

/**
 * Background blur radius (px) per setting. Stronger than the old whole-frame CSS
 * stand-in, because only the background is softened — the person stays crisp. For image
 * mode it's the fallback blur shown until the picture finishes loading.
 */
function blurPxFor(background: Background): number {
  return background === 'strong-blur' ? 18 : 9
}

function supported(): boolean {
  return (
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  )
}

/**
 * Applies the chosen background effect (blur, strong blur, or a virtual-background image)
 * to the raw camera, returning the stream to both publish and self-view. Off / camera-off
 * / unsupported → the raw stream, untouched.
 *
 * The effect is baked into the pixels, so peers see it too. Model load is lazy and async:
 * the raw (sharp) stream shows until the processed output is ready, then swaps once — a
 * single track replacement, not a flicker.
 */
export function useProcessedStream(
  raw: MediaStream | null,
  background: Background,
  backgroundImage: string | null,
  cameraOn: boolean,
): MediaStream | null {
  const [output, setOutput] = useState<MediaStream | null>(raw)
  const pipeRef = useRef<BackgroundEffect | null>(null)

  useEffect(() => {
    // "image" without a picked image yet is a no-op, not a broken black background.
    const wantsEffect =
      background === 'blur' ||
      background === 'strong-blur' ||
      (background === 'image' && !!backgroundImage)
    const active = !!raw && wantsEffect && cameraOn && supported()
    if (!active) {
      pipeRef.current?.stop()
      pipeRef.current = null
      setOutput(raw)
      return
    }

    const pipe = new BackgroundEffect(raw, {
      blurPx: blurPxFor(background),
      imageUrl: background === 'image' ? backgroundImage : null,
    })
    pipeRef.current = pipe
    let cancelled = false
    // Show the raw camera until the processed output is ready — then swap once.
    setOutput(raw)
    pipe
      .start()
      .then(() => {
        if (!cancelled) setOutput(pipe.output)
      })
      .catch(() => {
        if (!cancelled) setOutput(raw) // segmentation unavailable — untouched camera
      })

    return () => {
      cancelled = true
      pipe.stop()
      if (pipeRef.current === pipe) pipeRef.current = null
    }
  }, [raw, background, backgroundImage, cameraOn])

  return output
}
