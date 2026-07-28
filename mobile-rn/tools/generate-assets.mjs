/**
 * Generates every brand PNG this app ships: launcher icon, adaptive-icon
 * foreground, monochrome icon, native splash mark, and web favicon.
 *
 *   npm run icons
 *
 * The geometry below is the SAME geometry as components/FinAttLogo.tsx, in the
 * same 0..1 unit space. That is the whole point: the native splash shows this
 * PNG, then app/index.tsx fades in the SVG version on top. If the two drift the
 * handoff visibly jumps, so edit both together.
 *
 * No dependencies — SDF rasterisation plus Node's built-in zlib. The usual
 * choice, sharp, needs a libvips binary that will not install on every machine.
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ── palette — mirrors lib/theme.ts ─────────────────────────────────────────
const PLATE_FROM = [0x3b, 0x82, 0xf6] // brandLight
const PLATE_TO = [0x1d, 0x4e, 0xd8] // brandDark
const BACKDROP = [0x0a, 0x12, 0x30] // backdrop[0]
const WHITE = [0xff, 0xff, 0xff]

// ── geometry — mirrors components/FinAttLogo.tsx ───────────────────────────
const RING_R = 0.44
const RING_HALF_W = 0.015
const MARK_POINTS = [
  [0.32, 0.515],
  [0.445, 0.64],
  [0.69, 0.36],
]
const MARK_HALF_W = 0.045

// ── PNG encoding ───────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── signed distance fields ─────────────────────────────────────────────────
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const coverage = (d, aa) => clamp01(0.5 - d / aa)
const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))

function sdSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax
  const aby = by - ay
  const t = clamp01(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby))
  return Math.hypot(px - ax - abx * t, py - ay - aby * t)
}

function markDistance(x, y) {
  const [a, b, c] = MARK_POINTS
  return (
    Math.min(sdSegment(x, y, a[0], a[1], b[0], b[1]), sdSegment(x, y, b[0], b[1], c[0], c[1])) -
    MARK_HALF_W
  )
}

const ringDistance = (x, y) => Math.abs(Math.hypot(x - 0.5, y - 0.5) - RING_R) - RING_HALF_W

/**
 * @param shape 'plate'      circular gradient plate + ring + check (splash mark)
 *              'square'     full-bleed opaque square, no alpha (iOS store icon)
 *              'foreground' plate inside the 66% adaptive-icon safe zone
 *              'mono'       flat white silhouette (Android themed icons)
 */
/**
 * `scale` insets the drawn mark inside the canvas. Each output needs a
 * different inset, and getting it wrong is the difference between a crisp icon
 * and one that looks cropped:
 *
 *   square      full-bleed gradient, mark pulled in so iOS's rounded-corner
 *               mask never clips the ring
 *   plate       none — this one IS the logo, edge to edge
 *   foreground  Android adaptive: only the inner 66% is guaranteed visible
 *   mono        same 66% rule, themed-icon silhouette
 */
const INSET = { square: 0.74, plate: 1, foreground: 0.66, mono: 0.66 }

function render(size, shape) {
  const rgba = Buffer.alloc(size * size * 4)
  const scale = INSET[shape]
  const aa = 1.5 / (size * scale)

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const i = (py * size + px) * 4
      const gx = (px + 0.5) / size
      const gy = (py + 0.5) / size

      // Local space: re-centred so the inset scales about the middle.
      const x = (gx - 0.5) / scale + 0.5
      const y = (gy - 0.5) / scale + 0.5

      const disc = coverage(Math.hypot(x - 0.5, y - 0.5) - 0.5, aa)
      const glyph = Math.max(coverage(ringDistance(x, y), aa), coverage(markDistance(x, y), aa))

      if (shape === 'mono') {
        // Silhouette only — the launcher tints one flat shape.
        rgba[i] = rgba[i + 1] = rgba[i + 2] = 0xff
        rgba[i + 3] = Math.round(disc * 255)
        continue
      }

      // The square icon's gradient covers the whole canvas; the others are
      // clipped to the disc so they sit on a transparent background.
      const plate = shape === 'square' ? 1 : disc
      const alpha = plate + glyph * (1 - plate)
      if (alpha <= 0) continue

      // Gradient runs across the *canvas* for the square icon so it does not
      // visibly restart at the inset edge, and across the disc otherwise.
      const t = shape === 'square' ? clamp01((gx + gy) / 2) : clamp01((x + y) / 2)
      const [r, g, b] = lerp(PLATE_FROM, PLATE_TO, t)

      for (let ch = 0; ch < 3; ch++) {
        const under = [r, g, b][ch] * plate
        rgba[i + ch] = Math.round((under * (1 - glyph) + WHITE[ch] * glyph) / alpha)
      }
      rgba[i + 3] = Math.round(alpha * 255)
    }
  }
  return encodePng(size, rgba)
}

/** Favicon: the plate on the app's own backdrop, so it reads on a light tab bar. */
function renderFavicon(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const aa = 1.5 / size
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const i = (py * size + px) * 4
      const x = (px + 0.5) / size
      const y = (py + 0.5) / size
      const plate = coverage(Math.hypot(x - 0.5, y - 0.5) - 0.5, aa)
      const glyph = Math.max(coverage(ringDistance(x, y), aa), coverage(markDistance(x, y), aa))
      const [r, g, b] = lerp(PLATE_FROM, PLATE_TO, clamp01((x + y) / 2))
      for (let ch = 0; ch < 3; ch++) {
        const over = [r, g, b][ch] * (1 - glyph) + WHITE[ch] * glyph
        rgba[i + ch] = Math.round(BACKDROP[ch] * (1 - plate) + over * plate)
      }
      rgba[i + 3] = 255
    }
  }
  return encodePng(size, rgba)
}

function write(rel, buf) {
  const path = resolve(ROOT, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, buf)
  console.log(`  ${rel.padEnd(42)} ${(buf.length / 1024).toFixed(1)} kB`)
}

console.log('FinAtt brand assets')
// Store icons must be opaque squares — App Store Connect rejects alpha.
write('assets/icon.png', render(1024, 'square'))
// The native splash mark: transparent around the plate so it sits on backdrop.
write('assets/splash-icon.png', render(512, 'plate'))
write('assets/android-icon-foreground.png', render(1024, 'foreground'))
write('assets/android-icon-monochrome.png', render(1024, 'mono'))
write('assets/favicon.png', renderFavicon(64))

console.log('\nGeometry mirrors components/FinAttLogo.tsx — edit both together.')
