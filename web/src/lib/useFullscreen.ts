import { useCallback, useEffect, useState } from 'react'

/**
 * Browser fullscreen for the whole app, kept in sync with the real state — so the button
 * reflects reality even when the user leaves fullscreen with Esc (which doesn't go through
 * our toggle). Fullscreen can be refused (permissions, embedding); we fail quietly.
 */
export function useFullscreen(): { isFullscreen: boolean; toggle: () => void } {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement != null)
    document.addEventListener('fullscreenchange', sync)
    sync()
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
    } else {
      void document.documentElement.requestFullscreen().catch(() => {})
    }
  }, [])

  return { isFullscreen, toggle }
}
