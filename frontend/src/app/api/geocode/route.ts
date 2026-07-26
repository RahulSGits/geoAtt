import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

/**
 * Geocoding proxy over OpenStreetMap's Nominatim.
 *
 * Proxied rather than called from the browser for three reasons:
 *  - the app's CSP restricts `connect-src` to self and Supabase;
 *  - Nominatim's usage policy requires a descriptive User-Agent identifying the
 *    application, and browsers forbid setting that header from fetch();
 *  - it lets us enforce the 1 request/second limit centrally instead of trusting
 *    every client to behave.
 *
 * Nominatim is used because the maps are already OSM tiles, so results and
 * basemap agree, and it needs no API key.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org'
const CONTACT = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
const USER_AGENT = `FinAtt-Attendance/1.0 (${CONTACT})`

/** Nominatim asks for no more than one request per second, per application. */
const MIN_INTERVAL_MS = 1100
let lastRequestAt = 0

/** Small LRU-ish cache: HR types the same address repeatedly while adjusting a pin. */
const cache = new Map<string, { at: number; body: unknown }>()
const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX = 100

export interface GeocodeResult {
  label: string
  latitude: number
  longitude: number
  /** Nominatim importance, 0..1 — used to sort the better matches first. */
  importance: number
}

function cacheGet(key: string) {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit.body
}

function cacheSet(key: string, body: unknown) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, { at: Date.now(), body })
}

async function throttle() {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastRequestAt = Date.now()
}

export async function GET(request: NextRequest) {
  // Only signed-in staff may use this; it is a proxy to a third party and an
  // open one would let anyone burn our shared rate limit.
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const params = request.nextUrl.searchParams

  // Short Google Maps links carry no coordinates; only following the redirect
  // reveals them, and the browser cannot do that cross-origin.
  const shortUrl = params.get('url')?.trim()
  if (shortUrl) return resolveShortLink(shortUrl)

  const query = params.get('q')?.trim()
  const lat = params.get('lat')
  const lon = params.get('lon')

  const isReverse = Boolean(lat && lon)
  if (!query && !isReverse) {
    return NextResponse.json({ error: 'Provide q, or lat and lon.' }, { status: 400 })
  }
  if (query && query.length < 3) {
    return NextResponse.json({ results: [] })
  }

  const cacheKey = isReverse ? `r:${lat},${lon}` : `s:${query!.toLowerCase()}`
  const cached = cacheGet(cacheKey)
  if (cached) return NextResponse.json(cached)

  const url = new URL(isReverse ? `${NOMINATIM}/reverse` : `${NOMINATIM}/search`, NOMINATIM)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('addressdetails', '1')

  if (isReverse) {
    url.searchParams.set('lat', lat!)
    url.searchParams.set('lon', lon!)
    url.searchParams.set('zoom', '18')
  } else {
    url.searchParams.set('q', query!)
    url.searchParams.set('limit', '6')
  }

  try {
    await throttle()

    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: `Geocoding service returned ${res.status}.` },
        { status: 502 },
      )
    }

    const raw = await res.json()

    const toResult = (item: {
      display_name?: string
      lat?: string
      lon?: string
      importance?: number
    }): GeocodeResult | null => {
      const latitude = Number(item.lat)
      const longitude = Number(item.lon)
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
      return {
        label: item.display_name ?? '',
        latitude,
        longitude,
        importance: item.importance ?? 0,
      }
    }

    const body = isReverse
      ? { result: toResult(raw) }
      : {
          results: (Array.isArray(raw) ? raw : [])
            .map(toResult)
            .filter((r): r is GeocodeResult => r !== null)
            .sort((a, b) => b.importance - a.importance),
        }

    cacheSet(cacheKey, body)
    return NextResponse.json(body)
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    return NextResponse.json(
      { error: timedOut ? 'Address lookup timed out.' : 'Address lookup failed.' },
      { status: 504 },
    )
  }
}


const ALLOWED_LINK_HOSTS = new Set([
  'maps.app.goo.gl',
  'goo.gl',
  'www.google.com',
  'google.com',
  'maps.google.com',
])

/**
 * Follow a shortened Google Maps link and hand back the expanded URL.
 *
 * Host-allowlisted: this endpoint makes a server-side request to a
 * caller-supplied URL, which without a restriction is a server-side request
 * forgery primitive pointed at anything reachable from the host.
 */
async function resolveShortLink(input: string): Promise<NextResponse> {
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    return NextResponse.json({ error: 'That is not a valid URL.' }, { status: 400 })
  }

  if (parsed.protocol !== 'https:' || !ALLOWED_LINK_HOSTS.has(parsed.hostname)) {
    return NextResponse.json(
      { error: 'Only Google Maps links are supported.' },
      { status: 400 },
    )
  }

  try {
    // `redirect: follow` lands on the long URL, whose path holds the coordinates.
    const res = await fetch(parsed.toString(), {
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000),
    })

    return NextResponse.json({ resolvedUrl: res.url })
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    return NextResponse.json(
      { error: timedOut ? 'The link took too long to resolve.' : 'Could not open that link.' },
      { status: 504 },
    )
  }
}
