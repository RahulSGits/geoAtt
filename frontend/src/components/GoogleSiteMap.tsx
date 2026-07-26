'use client'

import { Circle, GoogleMap, useJsApiLoader } from '@react-google-maps/api'
import { useCallback, useMemo } from 'react'

/**
 * Google Maps geofence view, the alternative to the Leaflet/OSM one.
 *
 * Worth offering because OSM has almost no building-level data for Indian
 * addresses, where Google does — the satellite and hybrid views make placing a
 * pin on the right rooftop practical.
 *
 * Needs NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. That key ships to the browser by
 * design (it is a Maps JS key), so it must be locked to your domains under
 * "HTTP referrers" in the Google Cloud console, or anyone can spend your quota.
 */
export default function GoogleSiteMap({
  latitude,
  longitude,
  radius,
  onMove,
  interactive = true,
  height = 280,
  mapTypeId = 'roadmap',
}: {
  latitude: number | null
  longitude: number | null
  radius: number
  onMove?: (lat: number, lng: number) => void
  interactive?: boolean
  height?: number
  mapTypeId?: 'roadmap' | 'hybrid' | 'satellite'
}) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''

  const { isLoaded, loadError } = useJsApiLoader({
    id: 'finatt-google-maps',
    googleMapsApiKey: apiKey,
  })

  const center = useMemo(
    () => ({
      lat: Number.isFinite(latitude) && latitude !== null ? latitude : 12.9756,
      lng: Number.isFinite(longitude) && longitude !== null ? longitude : 77.6068,
    }),
    [latitude, longitude],
  )

  const handleClick = useCallback(
    (e: google.maps.MapMouseEvent) => {
      if (!interactive || !onMove || !e.latLng) return
      onMove(e.latLng.lat(), e.latLng.lng())
    },
    [interactive, onMove],
  )

  if (!apiKey) {
    return (
      <Placeholder height={height}>
        Google Maps needs <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>. Switch to the
        OpenStreetMap view, or add the key and restart.
      </Placeholder>
    )
  }

  if (loadError) {
    return (
      <Placeholder height={height}>
        Google Maps failed to load. The key may be missing a billing account, or this
        origin may not be allow-listed under its HTTP-referrer restrictions.
      </Placeholder>
    )
  }

  if (!isLoaded) {
    return <div className="skeleton w-full rounded-xl" style={{ height }} />
  }

  return (
    <GoogleMap
      center={center}
      zoom={16}
      onClick={handleClick}
      mapContainerStyle={{ height, width: '100%', borderRadius: 12 }}
      options={{
        mapTypeId,
        disableDefaultUI: !interactive,
        streetViewControl: false,
        fullscreenControl: false,
        mapTypeControl: interactive,
        gestureHandling: interactive ? 'greedy' : 'none',
        clickableIcons: false,
      }}
    >
      <Circle
        center={center}
        radius={radius}
        options={{
          strokeColor: '#1e40af',
          strokeOpacity: 0.9,
          strokeWeight: 2,
          fillColor: '#1e40af',
          fillOpacity: 0.15,
          clickable: false,
        }}
      />
      {/* A small filled circle stands in for a marker — it needs no icon asset
          and matches the Leaflet view's pin. */}
      <Circle
        center={center}
        radius={Math.max(4, radius * 0.03)}
        options={{
          strokeColor: '#ffffff',
          strokeWeight: 2,
          fillColor: '#1e40af',
          fillOpacity: 1,
          clickable: false,
        }}
      />
    </GoogleMap>
  )
}

function Placeholder({
  children,
  height,
}: {
  children: React.ReactNode
  height: number
}) {
  return (
    <div
      className="muted grid place-items-center rounded-xl border border-dashed border-[var(--border)] px-6 text-center text-xs"
      style={{ height }}
    >
      <span className="max-w-xs">{children}</span>
    </div>
  )
}
