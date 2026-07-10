import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/** @typedef {{ x?: number, y?: number, width: number, height: number, maximized?: boolean }} WindowState */

/** Load saved window state; corrupt/missing → null. */
export function loadWindowState(filePath) {
  try {
    if (!existsSync(filePath)) return null
    const raw = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const width = Number(parsed.width)
    const height = Number(parsed.height)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
      return null
    }
    /** @type {WindowState} */
    const state = { width, height }
    if (Number.isFinite(Number(parsed.x))) state.x = Number(parsed.x)
    if (Number.isFinite(Number(parsed.y))) state.y = Number(parsed.y)
    if (typeof parsed.maximized === 'boolean') state.maximized = parsed.maximized
    return state
  } catch {
    return null
  }
}

/** Persist window state synchronously. */
export function saveWindowState(state, filePath) {
  writeFileSync(filePath, JSON.stringify(state) + '\n', 'utf8')
}

/**
 * True when `bounds` intersects at least one display's bounds.
 * @param {{ x: number, y: number, width: number, height: number }} bounds
 * @param {{ bounds: { x: number, y: number, width: number, height: number } }[]} displays
 */
export function boundsOnScreen(bounds, displays) {
  if (bounds.x == null || bounds.y == null || !displays?.length) return false
  return displays.some((d) => {
    const a = d.bounds
    return (
      bounds.x + bounds.width > a.x &&
      bounds.x < a.x + a.width &&
      bounds.y + bounds.height > a.y &&
      bounds.y < a.y + a.height
    )
  })
}
