import geometry from './logo-geometry.json'

/**
 * SVG-side helpers for the geoAtt fingerprint mark.
 *
 * The numbers come from logo-geometry.json, which is the single definition —
 * tools/generate-assets.mjs reads the same file to rasterise the PNGs. Only the
 * *algorithms* differ between the two (arc paths here, signed distance fields
 * there), which is why the data lives in JSON rather than in either consumer.
 */

export type Ridge = {
  /** Distance from centre, in unit space. */
  r: number
  /** Start angle in degrees, SVG convention (0 = right, clockwise). */
  a0: number
  /** End angle in degrees. */
  a1: number
}

export const RIDGES: Ridge[] = geometry.ridges
export const RIDGE_HALF_W: number = geometry.halfWidth

/**
 * Arc centre. NOT the plate's own centre (0.5, 0.5) — see the "//center" note
 * in logo-geometry.json for why cy is pulled down to 0.664.
 */
export const CX: number = geometry.cx
export const CY: number = geometry.cy

export const rad = (deg: number) => (deg * Math.PI) / 180

/** Arc length of one ridge, for stroke-dash animation. */
export function ridgeLength(ridge: Ridge): number {
  return ridge.r * rad(ridge.a1 - ridge.a0)
}

/** Cartesian point at `deg` on a circle of radius `r` about (CX, CY). */
export function pointAt(r: number, deg: number): [number, number] {
  return [CX + r * Math.cos(rad(deg)), CY + r * Math.sin(rad(deg))]
}

/**
 * SVG path for one ridge, scaled into a `viewBox="0 0 100 100"` space.
 *
 * `largeArc` is computed rather than hardcoded: the outer fragments span well
 * under 180° while the inner ridges span more, and a wrong flag silently draws
 * the complement of the arc you asked for.
 */
export function ridgePath(ridge: Ridge, scale = 100): string {
  const [x0, y0] = pointAt(ridge.r, ridge.a0)
  const [x1, y1] = pointAt(ridge.r, ridge.a1)
  const largeArc = ridge.a1 - ridge.a0 > 180 ? 1 : 0
  const r = ridge.r * scale
  return `M ${x0 * scale} ${y0 * scale} A ${r} ${r} 0 ${largeArc} 1 ${x1 * scale} ${y1 * scale}`
}
