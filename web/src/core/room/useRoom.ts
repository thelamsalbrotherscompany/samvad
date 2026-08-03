import { useEffect, useState } from 'react'
import { normalizeRoomId } from './roomId'

function readHash(): string {
  return normalizeRoomId(decodeURIComponent(location.hash.replace(/^#/, '')))
}

/**
 * The current room, driven by the URL hash (`…/#warm-marigold-847`). Hash routing needs
 * no server rewrites, so it works as-is on Cloudflare Pages. Empty string = the landing.
 */
export function useRoom(): {
  roomId: string
  enterRoom: (id: string) => void
  leaveRoom: () => void
} {
  const [roomId, setRoomId] = useState<string>(readHash)

  useEffect(() => {
    const onHashChange = () => setRoomId(readHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return {
    roomId,
    enterRoom: (id: string) => {
      const clean = normalizeRoomId(id)
      if (clean) location.hash = clean
    },
    leaveRoom: () => {
      // Clear the hash without leaving a `#` dangling in the URL.
      history.pushState('', '', location.pathname + location.search)
      setRoomId('')
    },
  }
}
