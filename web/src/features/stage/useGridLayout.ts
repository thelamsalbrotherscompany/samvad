import { useEffect, useRef, useState } from 'react'

const ASPECT = 16 / 9
const GAP = 12

export type GridLayout = {
  cols: number
  rows: number
  /**
   * True when a cell is wider than 16:9, so the tile is limited by height.
   * Applied uniformly (every cell is the same size) to letterbox tiles correctly
   * without measuring each one.
   */
  heightConstrained: boolean
  /** Cells too narrow to show a name label without crowding the face. */
  compact: boolean
}

/**
 * Picks the column count that yields the largest 16:9 tile for `count`
 * participants in the measured container.
 *
 * Crucially, this hook only chooses the *shape* (cols × rows). The actual sizing
 * is done by CSS Grid `1fr` tracks in Stage, which can never overflow the
 * container — so a stale or slightly-off measurement changes only which grid
 * looks best, never whether everyone fits on screen.
 */
export function useGridLayout(count: number): {
  ref: React.RefObject<HTMLDivElement | null>
  layout: GridLayout
} {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setBox({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return { ref, layout: solve(count, box.width, box.height) }
}

function solve(count: number, width: number, height: number): GridLayout {
  if (count <= 1) return { cols: 1, rows: 1, heightConstrained: true, compact: false }
  if (width === 0 || height === 0) {
    return { cols: 1, rows: count, heightConstrained: true, compact: false }
  }

  let bestCols = 1
  let bestArea = 0

  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols)
    const cellW = (width - GAP * (cols - 1)) / cols
    const cellH = (height - GAP * (rows - 1)) / rows
    if (cellW <= 0 || cellH <= 0) continue

    // Largest 16:9 tile that fits this cell.
    const tileW = Math.min(cellW, cellH * ASPECT)
    const area = tileW * (tileW / ASPECT)
    if (area > bestArea) {
      bestArea = area
      bestCols = cols
    }
  }

  const cols = bestCols
  const rows = Math.ceil(count / cols)
  const cellW = (width - GAP * (cols - 1)) / cols
  const cellH = (height - GAP * (rows - 1)) / rows

  return {
    cols,
    rows,
    heightConstrained: cellW / cellH >= ASPECT,
    compact: cellW < 200,
  }
}
