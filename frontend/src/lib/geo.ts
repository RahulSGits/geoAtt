/** Geofence maths and browser geolocation helpers. */

export interface Coords {
  latitude: number
  longitude: number
  accuracy: number
}

export interface GeofenceResult {
  inside: boolean
  /** Metres from the site centre. */
  distance: number
  /** Metres past the fence; 0 when inside. */
  overshoot: number
}

const EARTH_RADIUS_M = 6_371_000

const toRad = (deg: number) => (deg * Math.PI) / 180

/** Great-circle distance in metres between two WGS-84 points. */
export function haversine(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Check a reading against a site's fence.
 *
 * GPS accuracy is treated as slack rather than ignored: a reading 210 m out
 * with ±80 m accuracy could genuinely be 130 m out, so a 200 m fence accepts
 * it. Without this, employees on the edge of a site are rejected at random.
 */
export function checkGeofence(
  reading: Pick<Coords, 'latitude' | 'longitude' | 'accuracy'>,
  site: { latitude: number; longitude: number; radius_m: number },
): GeofenceResult {
  const distance = haversine(
    reading.latitude,
    reading.longitude,
    site.latitude,
    site.longitude,
  )
  const slack = Math.min(reading.accuracy ?? 0, MAX_ACCURACY_SLACK_M)
  const overshoot = Math.max(0, distance - site.radius_m - slack)
  return { inside: overshoot === 0, distance, overshoot }
}

/** Cap on how much GPS error we are willing to forgive. */
export const MAX_ACCURACY_SLACK_M = 75

/** Readings fuzzier than this are rejected outright rather than trusted. */
export const MAX_ACCEPTABLE_ACCURACY_M = 250

export class GeolocationFailure extends Error {
  constructor(
    message: string,
    readonly code: 'unsupported' | 'denied' | 'unavailable' | 'timeout' | 'imprecise',
  ) {
    super(message)
    this.name = 'GeolocationFailure'
  }
}

/** Promise wrapper over `navigator.geolocation` with a high-accuracy request. */
export function getCurrentPosition(timeoutMs = 15_000): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(
        new GeolocationFailure(
          'This browser does not expose location services.',
          'unsupported',
        ),
      )
      return
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords
        if (accuracy > MAX_ACCEPTABLE_ACCURACY_M) {
          reject(
            new GeolocationFailure(
              `Location is only accurate to ±${Math.round(accuracy)} m, which is too imprecise to verify your site. Move outdoors or enable precise location, then retry.`,
              'imprecise',
            ),
          )
          return
        }
        resolve({ latitude, longitude, accuracy })
      },
      (err) => {
        switch (err.code) {
          case err.PERMISSION_DENIED:
            reject(
              new GeolocationFailure(
                'Location permission was denied. Enable it for this site to check in.',
                'denied',
              ),
            )
            break
          case err.TIMEOUT:
            reject(
              new GeolocationFailure(
                'Timed out while locating you. Move somewhere with a clearer sky view and retry.',
                'timeout',
              ),
            )
            break
          default:
            reject(
              new GeolocationFailure(
                'Your position could not be determined. Check that location services are on.',
                'unavailable',
              ),
            )
        }
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    )
  })
}

export function formatDistance(metres: number): string {
  return metres < 1000
    ? `${Math.round(metres)} m`
    : `${(metres / 1000).toFixed(2)} km`
}


/* ── Google Maps links ────────────────────────────────────────────────────── */

export interface ParsedMapsLink {
  latitude: number
  longitude: number
  /** Name pulled from a /place/ URL, when the link carries one. */
  label?: string
}

/**
 * Pull coordinates out of a pasted Google Maps URL.
 *
 * Handles every long-form shape Google produces:
 *   /maps/@28.5951,77.3156,17z
 *   /maps/place/Name/@28.5951,77.3156,17z/...
 *   /maps/search/?api=1&query=28.5951,77.3156
 *   ?q=28.5951,77.3156   |   ?ll=...   |   !3d28.5951!4d77.3156
 *
 * Short links (maps.app.goo.gl, goo.gl/maps) carry no coordinates at all — they
 * have to be followed server-side first, which /api/geocode?url= does.
 */
export function parseGoogleMapsUrl(input: string): ParsedMapsLink | null {
  const raw = input.trim()
  if (!raw) return null

  const valid = (lat: number, lng: number) =>
    Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)

  // `!3d<lat>!4d<lng>` is the most precise: it is the actual place pin, whereas
  // `@lat,lng` is only the map viewport centre.
  const bang = raw.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
  if (bang) {
    const lat = Number(bang[1])
    const lng = Number(bang[2])
    if (valid(lat, lng)) return { latitude: lat, longitude: lng, label: placeName(raw) }
  }

  const at = raw.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
  if (at) {
    const lat = Number(at[1])
    const lng = Number(at[2])
    if (valid(lat, lng)) return { latitude: lat, longitude: lng, label: placeName(raw) }
  }

  // ?q= / ?query= / ?ll= / ?center=
  const param = raw.match(
    /[?&](?:q|query|ll|center|destination)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
  )
  if (param) {
    const lat = Number(param[1])
    const lng = Number(param[2])
    if (valid(lat, lng)) return { latitude: lat, longitude: lng, label: placeName(raw) }
  }

  // Bare "lat, lng" pasted on its own.
  const bare = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/)
  if (bare) {
    const lat = Number(bare[1])
    const lng = Number(bare[2])
    if (valid(lat, lng)) return { latitude: lat, longitude: lng }
  }

  return null
}

function placeName(url: string): string | undefined {
  const m = url.match(/\/maps\/place\/([^/@]+)/)
  if (!m) return undefined
  try {
    return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim() || undefined
  } catch {
    return undefined
  }
}

/** Short links need a redirect follow, which only the server can do. */
export function isShortMapsLink(input: string): boolean {
  return /(maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(input)
}
