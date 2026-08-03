import { useState } from 'react'

/** The shareable room link, plus a copy action with a brief "copied" confirmation. */
export function useCopyLink(roomName: string) {
  const [copied, setCopied] = useState(false)
  // The real, shareable URL for this room — works in dev (localhost) and prod alike.
  const link = `${location.origin}${location.pathname}#${roomName}`

  function copy() {
    void navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return { link, copied, copy }
}
