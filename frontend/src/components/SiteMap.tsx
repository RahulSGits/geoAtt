'use client'

import 'leaflet/dist/leaflet.css'
import { Circle, CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { useEffect, useId } from 'react'

/**
 * Geofence editor. Click the map to move the centre; the shaded circle is the
 * radius employees must stand inside to check in.
 *
 * Rendered through `next/dynamic({ ssr: false })` by callers — Leaflet touches
 * `window` at import time and cannot be server-rendered.
 */
export default function SiteMap({
  latitude,
  longitude,
  radius,
  onMove,
  interactive = true,
  height = 280,
}: {
  /** Null for a remote site, which has no fixed place to draw. */
  latitude: number | null
  longitude: number | null
  radius: number
  onMove?: (lat: number, lng: number) => void
  interactive?: boolean
  height?: number
}) {
  // Leaflet binds an instance to the DOM node and refuses to re-init it. React
  // can reuse that node across remounts (Fast Refresh, a modal reopening),
  // which throws "Map container is being reused by another instance". A unique
  // key forces a fresh node each mount.
  const instanceId = useId()

  const valid =
    latitude !== null &&
    longitude !== null &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude)
  const center: [number, number] = valid ? [latitude, longitude] : [12.9756, 77.6068]

  return (
    <MapContainer
      key={instanceId}
      center={center}
      zoom={16}
      scrollWheelZoom={interactive}
      dragging={interactive}
      style={{ height, width: '100%', borderRadius: 12, zIndex: 0 }}
      aria-label="Work site geofence map"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />

      <Circle
        center={center}
        radius={radius}
        pathOptions={{ color: '#1e40af', fillColor: '#1e40af', fillOpacity: 0.15, weight: 2 }}
      />
      {/* A vector marker avoids Leaflet's default icon, whose PNG paths break
          under a bundler without extra asset wiring. */}
      <CircleMarker
        center={center}
        radius={6}
        pathOptions={{ color: '#fff', fillColor: '#1e40af', fillOpacity: 1, weight: 2 }}
      />

      <Recenter center={center} />
      {interactive && onMove && <ClickHandler onMove={onMove} />}
    </MapContainer>
  )
}

/** Keep the viewport following the coordinates when they change via the form. */
function Recenter({ center }: { center: [number, number] }) {
  const map = useMap()
  useEffect(() => {
    map.setView(center, map.getZoom())
  }, [center, map])
  return null
}

function ClickHandler({ onMove }: { onMove: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMove(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}
