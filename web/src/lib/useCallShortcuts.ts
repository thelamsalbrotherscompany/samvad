import { useEffect, useRef } from 'react'

type Options = {
  /** Only listen while you're actually in the call. */
  enabled: boolean
  micOn: boolean
  setMicOn: (on: boolean) => void
  toggleCamera: () => void
  toggleHand: () => void
}

/**
 * Call keyboard shortcuts: **M** toggles the mic, **V** the camera, **H** your hand, and
 * **holding Space** is push-to-talk (unmute while held, re-mute on release). Keys are
 * ignored while typing (an input, textarea, or contenteditable — so the chat composer and
 * name fields are never hijacked), and modifier combos (⌘/Ctrl/Alt) pass through untouched.
 *
 * Latest props are read through a ref so the listeners stay attached across mic/camera
 * changes — otherwise a push-to-talk release could land on a stale handler and never re-mute.
 */
export function useCallShortcuts(opts: Options): void {
  const latest = useRef(opts)
  latest.current = opts
  const pttHolding = useRef(false)

  useEffect(() => {
    if (!opts.enabled) return

    const isTyping = () => {
      const el = document.activeElement as HTMLElement | null
      if (!el) return false
      return (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable
      )
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping() || e.metaKey || e.ctrlKey || e.altKey) return
      const o = latest.current

      // Push-to-talk: hold Space to talk while muted.
      if (e.code === 'Space') {
        if (e.repeat) {
          e.preventDefault()
          return
        }
        if (!o.micOn) {
          e.preventDefault()
          pttHolding.current = true
          o.setMicOn(true)
        }
        return
      }

      switch (e.key.toLowerCase()) {
        case 'm':
          e.preventDefault()
          o.setMicOn(!o.micOn)
          break
        case 'v':
          e.preventDefault()
          o.toggleCamera()
          break
        case 'h':
          e.preventDefault()
          o.toggleHand()
          break
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && pttHolding.current) {
        pttHolding.current = false
        latest.current.setMicOn(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      // If we tore down mid-hold, don't leave the mic stuck open.
      if (pttHolding.current) {
        pttHolding.current = false
        latest.current.setMicOn(false)
      }
    }
    // Only re-bind when entering/leaving the call; live values come via the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled])
}
