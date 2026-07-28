/**
 * Generates the app icons and splash screens for both native projects.
 *
 * The usual tool for this is `@capacitor/assets`, but it depends on `sharp`,
 * whose libvips binary would not download here. Everything below is drawn from
 * signed distance fields and written as PNG with Node's built-in zlib, so the
 * script has no dependencies at all and stays runnable on any machine.
 *
 *   node tools/generate-icons.mjs
 *
 * Re-run it after editing MARK or the palette; it overwrites in place.
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ── palette ────────────────────────────────────────────────────────────────
const GRADIENT_FROM = [0x3b, 0x82, 0xf6] // blue-500
const GRADIENT_TO = [0x1d, 0x4e, 0xd8] // blue-700
const SPLASH_BG = [0x0b, 0x12, 0x20] // matches the app shell
const WHITE = [0xff, 0xff, 0xff]

/**
 * The mark: a check, in unit coordinates. An attendance app's icon has to read
 * at 48 px on an Android launcher, so it is one shape with generous stroke
 * weight rather than a wordmark that would turn to mud at that size.
 */
const MARK = {
  points: [
    [0.3, 0.53],
    [0.445, 0.672],
    [0.71, 0.335],
  ],
  thickness: 0.079,
}

// ── PNG encoding ───────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
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

/** RGBA pixel buffer -> PNG. Filter byte 0 per scanline; zlib does the rest. */
function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  // 10..12 = compression, filter, interlace — all 0.

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── signed distance fields ─────────────────────────────────────────────────
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Distance from p to the segment ab, in unit space. */
function sdSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax
  const aby = by - ay
  const apx = px - ax
  const apy = py - ay
  const t = clamp01((apx * abx + apy * aby) / (abx * abx + aby * aby))
  const dx = apx - abx * t
  const dy = apy - aby * t
  return Math.hypot(dx, dy)
}

function sdRoundedBox(px, py, half, radius) {
  const qx = Math.abs(px) - half + radius
  const qy = Math.abs(py) - half + radius
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
}

/** Coverage in [0,1] for a distance field, antialiased over one pixel. */
const coverage = (dist, aa) => clamp01(0.5 - dist / aa)

function markDistance(x, y) {
  const [a, b, c] = MARK.points
  return (
    Math.min(sdSegment(x, y, a[0], a[1], b[0], b[1]), sdSegment(x, y, b[0], b[1], c[0], c[1])) -
    MARK.thickness / 2
  )
}

const lerp = (from, to, t) => from.map((v, i) => Math.round(v + (to[i] - v) * t))

/**
 * @param shape 'full'    square, edge to edge, fully opaque (iOS masks it itself)
 *              'rounded' squircle on transparency (Android legacy launcher icon)
 *              'circle'  round (Android round launcher icon)
 *              'mark'    the check alone on transparency (adaptive foreground)
 */
function renderIcon(size, shape) {
  const rgba = Buffer.alloc(size * size * 4)
  const aa = 1.5 / size

  // The adaptive-icon foreground keeps the mark inside the 66% safe zone —
  // outside it the launcher is free to crop for its own mask shape.
  const scale = shape === 'mark' ? 0.66 : 1

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / size
      const y = (py + 0.5) / size

      let bgAlpha
      if (shape === 'full') bgAlpha = 1
      else if (shape === 'circle') bgAlpha = coverage(Math.hypot(x - 0.5, y - 0.5) - 0.5, aa)
      else if (shape === 'rounded') bgAlpha = coverage(sdRoundedBox(x - 0.5, y - 0.5, 0.5, 0.225), aa)
      else bgAlpha = 0

      const [r, g, b] = lerp(GRADIENT_FROM, GRADIENT_TO, clamp01((x + y) / 2))

      // Mark coordinates, re-centred when scaled down for the safe zone.
      const mx = (x - 0.5) / scale + 0.5
      const my = (y - 0.5) / scale + 0.5
      const markAlpha = coverage(markDistance(mx, my), aa / scale)

      // Composite: white mark over the gradient plate.
      const alpha = bgAlpha + markAlpha * (1 - bgAlpha)
      const i = (py * size + px) * 4
      if (alpha <= 0) continue
      for (let ch = 0; ch < 3; ch++) {
        const plate = [r, g, b][ch] * bgAlpha
        rgba[i + ch] = Math.round((plate * (1 - markAlpha) + WHITE[ch] * markAlpha) / alpha)
      }
      rgba[i + 3] = Math.round(alpha * 255)
    }
  }
  return encodePng(size, size, rgba)
}

/** Splash: the gradient plate centred on the app's own background colour. */
function renderSplash(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const aa = 1.5 / size
  const plate = 0.19 // plate width as a fraction of the canvas

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / size
      const y = (py + 0.5) / size
      const i = (py * size + px) * 4

      // Local coordinates inside the centred plate.
      const lx = (x - 0.5) / plate + 0.5
      const ly = (y - 0.5) / plate + 0.5
      const localAa = aa / plate

      const plateAlpha = coverage(sdRoundedBox(lx - 0.5, ly - 0.5, 0.5, 0.225), localAa)
      const [r, g, b] = lerp(GRADIENT_FROM, GRADIENT_TO, clamp01((lx + ly) / 2))
      const markAlpha = coverage(markDistance(lx, ly), localAa)

      for (let ch = 0; ch < 3; ch++) {
        const over = [r, g, b][ch] * (1 - markAlpha) + WHITE[ch] * markAlpha
        rgba[i + ch] = Math.round(SPLASH_BG[ch] * (1 - plateAlpha) + over * plateAlpha)
      }
      rgba[i + 3] = 255
    }
  }
  return encodePng(size, size, rgba)
}

// ── outputs ────────────────────────────────────────────────────────────────
function write(relative, buffer) {
  const path = resolve(ROOT, relative)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, buffer)
  console.log(`  ${relative}  ${(buffer.length / 1024).toFixed(1)} kB`)
}

// Android launcher densities: mdpi 48dp baseline, up to xxxhdpi at 4x.
const DENSITIES = [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
]

console.log('iOS')
// A single 1024×1024 opaque icon — Xcode 14+ takes one size and derives the
// rest, and App Store Connect rejects an icon carrying an alpha channel.
write('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', renderIcon(1024, 'full'))

const splash = renderSplash(2732)
for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  write(`ios/App/App/Assets.xcassets/Splash.imageset/${name}`, splash)
}

console.log('Android')
for (const [density, size] of DENSITIES) {
  write(`android/app/src/main/res/mipmap-${density}/ic_launcher.png`, renderIcon(size, 'rounded'))
  write(`android/app/src/main/res/mipmap-${density}/ic_launcher_round.png`, renderIcon(size, 'circle'))
  // Adaptive foreground is 108dp against the 48dp baseline — 2.25× each bucket.
  write(
    `android/app/src/main/res/mipmap-${density}/ic_launcher_foreground.png`,
    renderIcon(Math.round(size * 2.25), 'mark'),
  )
}

// Portrait and landscape splash buckets all take the same square artwork; it is
// centre-cropped by the splash theme, and a square survives both orientations.
for (const [density] of DENSITIES) {
  write(`android/app/src/main/res/drawable-port-${density}/splash.png`, splash)
  write(`android/app/src/main/res/drawable-land-${density}/splash.png`, splash)
}
write('android/app/src/main/res/drawable/splash.png', splash)

console.log('\nDone. Run `npm run sync` to push these into the native projects.')
