'use client'

import dynamic from 'next/dynamic'
import { useState, useSyncExternalStore } from 'react'
import { Layers, Link2, Loader2, Map as MapIcon, Satellite } from 'lucide-react'
import { isShortMapsLink, parseGoogleMapsUrl } from '@/lib/geo'
import { Alert } from './ui'

const LeafletMap = dynamic(() => import('./SiteMap'), {
  ssr: false,
  loading: () => <div className="skeleton h-[280px] w-full rounded-xl" />,
})

const GoogleMapView = dynamic(() => import('./GoogleSiteMap'), {
  ssr: false,
  loading: () => <div className="skeleton h-[280px] w-full rounded-xl" />,
})

type Provider = 'osm' | 'google' | 'satellite'
const STORAGE_KEY = 'finatt.mapProvider'

const PROVIDER_EVENT = 'finatt:mapprovider'

function subscribeToProvider(onChange: () => void) {
  window.addEventListener(PROVIDER_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(PROVIDER_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

function readProvider(): Provider {
  const saved = window.localStorage.getItem(STORAGE_KEY)
  return saved === 'google' || saved === 'satellite' || saved === 'osm' ? saved : 'osm'
}

const PROVIDERS: { id: Provider; label: string; icon: typeof MapIcon }[] = [
  { id: 'osm', label: 'OpenStreetMap', icon: MapIcon },
  { id: 'google', label: 'Google', icon: Layers },
  { id: 'satellite', label: 'Satellite', icon: Satellite },
]

/**
 * Map + provider switch + Google-link importer for the site editor.
 *
 * Two providers because they fail in opposite directions: OSM is free and needs
 * no key but has almost no building-level data for Indian addresses, while
 * Google resolves those but needs a billed, referrer-restricted key.
 */
export default function SitePicker({
  latitude,
  longitude,
  radius,
  onMove,
  onName,
}: {
  latitude: number | null
  longitude: number | null
  radius: number
  onMove: (lat: number, lng: number) => void
  /** Called when a pasted /place/ link carries a business name. */
  onName?: (name: string) => void
}) {
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)

  // Read straight from localStorage via useSyncExternalStore rather than
  // hydrating into state inside an effect: that pattern writes state during the
  // effect, which cascades an extra render (and the React Compiler rejects it).
  const provider = useSyncExternalStore(subscribeToProvider, readProvider, () => 'osm' as Provider)

  function choose(next: Provider) {
    window.localStorage.setItem(STORAGE_KEY, next)
    // Same-tab writes do not fire `storage`, so announce it ourselves.
    window.dispatchEvent(new Event(PROVIDER_EVENT))
  }

  async function importLink(raw: string) {
    const value = raw.trim()
    if (!value) return

    setBusy(true)
    setStatus(null)

    let target = value

    // A short link has no coordinates in it at all; the server follows the
    // redirect to reveal the long URL.
    if (isShortMapsLink(value)) {
      try {
        const res = await fetch(`/api/geocode?url=${encodeURIComponent(value)}`)
        const body = await res.json()
        if (!res.ok || !body.resolvedUrl) {
          setStatus({ ok: false, message: body.error ?? 'Could not open that short link.' })
          setBusy(false)
          return
        }
        target = body.resolvedUrl
      } catch {
        setStatus({ ok: false, message: 'Could not reach the link resolver.' })
        setBusy(false)
        return
      }
    }

    const parsed = parseGoogleMapsUrl(target)
    if (!parsed) {
      setStatus({
        ok: false,
        message:
          'No coordinates in that link. Open the place in Google Maps, use Share → Copy link, and paste that.',
      })
      setBusy(false)
      return
    }

    onMove(parsed.latitude, parsed.longitude)
    if (parsed.label && onName) onName(parsed.label)
    setStatus({
      ok: true,
      message: `Pin moved to ${parsed.latitude.toFixed(5)}, ${parsed.longitude.toFixed(5)}${
        parsed.label ? ` — ${parsed.label}` : ''
      }`,
    })
    setBusy(false)
  }

  return (
    <div className="space-y-2">
      {/* Provider switch */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="Map provider"
          className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5"
        >
          {PROVIDERS.map((p) => {
            const Icon = p.icon
            const active = provider === p.id
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => choose(p.id)}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer"
                style={
                  active
                    ? { background: 'var(--primary)', color: 'var(--primary-fg)' }
                    : { color: 'var(--text-muted)' }
                }
              >
                <Icon size={13} />
                {p.label}
              </button>
            )
          })}
        </div>
      </div>

      {provider === 'osm' ? (
        <LeafletMap
          latitude={latitude}
          longitude={longitude}
          radius={radius}
          onMove={onMove}
        />
      ) : (
        <GoogleMapView
          latitude={latitude}
          longitude={longitude}
          radius={radius}
          onMove={onMove}
          mapTypeId={provider === 'satellite' ? 'hybrid' : 'roadmap'}
        />
      )}

      {/* Google Maps link import */}
      <div>
        <label className="label" htmlFor="maps-link">
          Or paste a Google Maps link
        </label>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Link2
              size={15}
              className="muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            />
            <input
              id="maps-link"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onPaste={(e) => {
                // Import straight from the paste, so it works in one action.
                const text = e.clipboardData.getData('text')
                if (text) {
                  setLink(text)
                  void importLink(text)
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void importLink(link)
                }
              }}
              placeholder="https://maps.app.goo.gl/… or 28.5951, 77.3156"
              className="field pl-9"
            />
          </div>
          <button
            type="button"
            onClick={() => importLink(link)}
            disabled={busy || !link.trim()}
            className="btn btn-ghost shrink-0"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : null}
            Use link
          </button>
        </div>

        {status ? (
          <div className="mt-2">
            <Alert tone={status.ok ? 'success' : 'error'}>{status.message}</Alert>
          </div>
        ) : (
          <p className="muted mt-1 text-xs">
            In Google Maps: Share → Copy link. Short goo.gl links work too.
          </p>
        )}
      </div>
    </div>
  )
}
