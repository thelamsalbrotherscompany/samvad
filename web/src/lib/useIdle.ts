import { useEffect, useState } from 'react'

/**
 * True once the pointer/keyboard has been quiet for `delay` ms.
 * Drives chrome auto-hide: the video is the interface (docs/DESIGN.md).
 */
export function useIdle(delay = 3000): boolean {
  const [idle, setIdle] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>

    const reset = () => {
      setIdle(false)
      clearTimeout(timer)
      timer = setTimeout(() => setIdle(true), delay)
    }

    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    reset()

    return () => {
      clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, reset))
    }
  }, [delay])

  return idle
}
