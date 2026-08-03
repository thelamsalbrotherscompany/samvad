import { useEffect, useState } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const update = () => setMatches(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [query])

  return matches
}

/**
 * "Narrow" is the phone-shaped breakpoint. Below it, the stage is always
 * speaker-focused — a grid of faces is useless at this width (docs/DESIGN.md).
 */
export const useIsNarrow = () => useMediaQuery('(max-width: 680px)')
