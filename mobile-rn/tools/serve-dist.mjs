/**
 * Serves the production web export locally, the way Firebase Hosting will.
 *
 *   npm run serve:web            # after npm run build:web
 *   PORT=8090 npm run serve:web
 *
 * Why this exists rather than `python3 -m http.server`: it reproduces the SPA
 * rewrite from firebase.json. `web.output` is "single", so /login has no file
 * on disk — a plain static server 404s it and you only discover that after
 * deploying. Here an unknown path falls through to index.html, exactly as
 * hosting does, so deep links and refreshes are actually exercised.
 *
 * Paths are resolved relative to this file, never process.cwd().
 */

import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const PORT = Number(process.env.PORT || process.argv[2] || 8090)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
}

async function fileAt(path) {
  try {
    const info = await stat(path)
    return info.isFile() ? path : null
  } catch {
    return null
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  // normalize() collapses any ../ before it can escape DIST.
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')

  const target = (await fileAt(join(DIST, rel))) ?? (await fileAt(join(DIST, 'index.html')))

  if (!target) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('dist/ not found — run `npm run build:web` first.')
    return
  }

  res.writeHead(200, {
    'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
    // Mirrors the hosting headers: hashed assets immutable, shell never cached.
    'cache-control': target.includes('/_expo/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache, max-age=0',
  })
  createReadStream(target).pipe(res)
})

server.listen(PORT, () => {
  console.log(`Serving ${DIST}\n  http://localhost:${PORT}`)
})
