'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import { Building2, Crosshair, Home, MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import Modal from '@/components/Modal'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import { Alert, EmptyState, PageHeader, Panel, Pill, SearchInput, Spinner } from '@/components/ui'
import AddressSearch from '@/components/AddressSearch'
import SitePicker from '@/components/SitePicker'
import { getCurrentPosition } from '@/lib/geo'
import { enforcesGeofence, siteKindMeta, siteKindOf } from '@/lib/types'
import type { Site, SiteKind } from '@/lib/types'
import { deleteSite, saveSite } from '../actions'

// Leaflet reads `window` on import, so it can only load in the browser.
const SiteMap = dynamic(() => import('@/components/SiteMap'), {
  ssr: false,
  loading: () => <div className="skeleton h-[280px] w-full rounded-xl" />,
})

export default function SitesSection({ sites }: { sites: Site[] }) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Site | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Site | null>(null)
  const [deleting, setDeleting] = useState(false)

  const needle = query.trim().toLowerCase()
  const shown = needle
    ? sites.filter((s) =>
        `${s.name} ${s.address ?? ''} ${siteKindOf(s)}`.toLowerCase().includes(needle),
      )
    : sites
  const toast = useToast()
  const router = useRouter()

  async function handleDelete() {
    if (!confirmDelete) return
    setDeleting(true)

    const fd = new FormData()
    fd.set('id', confirmDelete.id)
    const res = await deleteSite(fd)

    if (res.ok) {
      toast.success('Site deleted.')
      setConfirmDelete(null)
      router.refresh()
    } else {
      toast.error(res.error)
      setDeleting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Work sites"
        subtitle="Where your people work — office geofences, remote, or hybrid"
        action={
          <button onClick={() => setCreating(true)} className="btn btn-primary btn-sm">
            <Plus size={15} /> Add site
          </button>
        }
      />

      {sites.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search sites by name, address or type"
            label="Search work sites"
          />
          {query && (
            <span className="muted text-xs">
              {shown.length} of {sites.length}
            </span>
          )}
        </div>
      )}

      {sites.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<MapPin size={30} />}
            title="No sites configured"
            description="Add an office with a geofence, or a remote site for staff working from home."
            action={
              <button onClick={() => setCreating(true)} className="btn btn-primary btn-sm">
                <Plus size={15} /> Add site
              </button>
            }
          />
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {shown.map((site) => (
            <Panel
              key={site.id}
              className="relative overflow-hidden"
              style={{
                borderColor: `color-mix(in srgb, ${siteKindMeta[siteKindOf(site)].color} 35%, var(--border))`,
              }}
              accent={siteKindMeta[siteKindOf(site)].color}
              title={site.name}
              subtitle={site.address ?? undefined}
              action={
                <div className="flex items-center gap-1">
                  <Pill tone={siteKindMeta[siteKindOf(site)].color}>
                    {siteKindMeta[siteKindOf(site)].label}
                  </Pill>
                  <Pill tone={site.is_active ? 'var(--success)' : 'var(--text-muted)'}>
                    {site.is_active ? 'Active' : 'Inactive'}
                  </Pill>
                  <button
                    onClick={() => setEditing(site)}
                    aria-label={`Edit ${site.name}`}
                    className="icon-btn"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => setConfirmDelete(site)}
                    aria-label={`Delete ${site.name}`}
                    className="icon-btn icon-btn-danger"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              }
              bodyClassName="p-3"
            >
              {enforcesGeofence(site) ? (
                <>
                  <SiteMap
                    latitude={site.latitude}
                    longitude={site.longitude}
                    radius={site.radius_m}
                    interactive={false}
                    height={200}
                  />
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="muted">Latitude</dt>
                      <dd className="font-mono">{site.latitude?.toFixed(5) ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="muted">Longitude</dt>
                      <dd className="font-mono">{site.longitude?.toFixed(5) ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="muted">Radius</dt>
                      <dd className="font-mono">{site.radius_m} m</dd>
                    </div>
                  </dl>
                </>
              ) : (
                <div className="flex items-start gap-3 rounded-lg bg-[var(--surface-2)] p-4">
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-lg"
                    style={{
                      background: `color-mix(in srgb, ${siteKindMeta[siteKindOf(site)].color} 16%, transparent)`,
                      color: siteKindMeta[siteKindOf(site)].color,
                    }}
                  >
                    {siteKindOf(site) === 'remote' ? <Home size={19} /> : <Building2 size={19} />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{siteKindMeta[siteKindOf(site)].label}</p>
                    <p className="muted mt-0.5 text-xs">{siteKindMeta[siteKindOf(site)].description}</p>
                  </div>
                </div>
              )}
            </Panel>
          ))}
        </div>
      )}

      <Modal
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        title={editing ? `Edit ${editing.name}` : 'Add work site'}
        description="Pick how the site is worked. Only an office is location-restricted."
        size="lg"
      >
        <SiteForm
          key={editing?.id ?? 'new'}
          site={editing}
          onDone={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      </Modal>

      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Delete site?"
        description={confirmDelete?.name}
        size="sm"
      >
        <div className="space-y-3">
          <Alert tone="warning">
            Employees assigned to this site will be left unassigned and unable to check
            in until you give them a new one.
          </Alert>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDelete(null)} className="btn btn-ghost">
              Cancel
            </button>
            <button onClick={handleDelete} disabled={deleting} className="btn btn-danger">
              {deleting && <Spinner size={16} />} Delete
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}

function SiteForm({ site, onDone }: { site: Site | null; onDone: () => void }) {
  const [kind, setKind] = useState<SiteKind>(siteKindOf(site))
  const [lat, setLat] = useState(site?.latitude ?? 12.9756)
  const [lng, setLng] = useState(site?.longitude ?? 77.6068)
  const [radius, setRadius] = useState(site?.radius_m ?? 150)
  const [address, setAddress] = useState(site?.address ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  const router = useRouter()

  // Only an office is fenced, so only an office needs a map and coordinates.
  const needsLocation = kind === 'office' || kind === 'hybrid'

  /** Look up the street address for a pin position and fill the field. */
  async function fillAddressFrom(latitude: number, longitude: number) {
    try {
      const res = await fetch(`/api/geocode?lat=${latitude}&lon=${longitude}`)
      if (!res.ok) return
      const body = await res.json()
      if (body?.result?.label) setAddress(body.result.label)
    } catch {
      // Reverse lookup is a convenience; the pin is already placed.
    }
  }

  function moveTo(latitude: number, longitude: number) {
    setLat(latitude)
    setLng(longitude)
    void fillAddressFrom(latitude, longitude)
  }

  async function useMyLocation() {
    setLocating(true)
    try {
      const pos = await getCurrentPosition()
      moveTo(pos.latitude, pos.longitude)
      toast.success('Centred on your current location.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read your location.')
    } finally {
      setLocating(false)
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const fd = new FormData(e.currentTarget)
    if (site) fd.set('id', site.id)
    fd.set('kind', kind)
    // A remote site has no coordinates; send blanks so the server stores null.
    fd.set('latitude', needsLocation ? String(lat) : '')
    fd.set('longitude', needsLocation ? String(lng) : '')
    fd.set('radius', String(radius))

    const res = await saveSite(fd)
    if (res.ok) {
      toast.success(site ? 'Site updated.' : 'Site created.')
      onDone()
      router.refresh()
    } else {
      setError(res.error)
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <fieldset>
        <legend className="label">How is this site worked?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(siteKindMeta) as SiteKind[]).map((option) => {
            const Icon = option === 'remote' ? Home : option === 'hybrid' ? Building2 : MapPin
            const active = kind === option
            return (
              <label
                key={option}
                className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors"
                style={{
                  borderColor: active ? siteKindMeta[option].color : 'var(--border)',
                  background: active
                    ? `color-mix(in srgb, ${siteKindMeta[option].color} 10%, transparent)`
                    : 'transparent',
                }}
              >
                <input
                  type="radio"
                  name="kindRadio"
                  value={option}
                  checked={active}
                  onChange={() => setKind(option)}
                  className="sr-only"
                />
                <Icon
                  size={16}
                  className="mt-0.5 shrink-0"
                  style={{ color: active ? siteKindMeta[option].color : 'var(--text-muted)' }}
                />
                <span className="min-w-0">
                  <span
                    className="block text-sm font-medium"
                    style={{ color: active ? siteKindMeta[option].color : 'var(--text)' }}
                  >
                    {siteKindMeta[option].label}
                  </span>
                  <span className="muted block text-xs">
                    {siteKindMeta[option].description}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {needsLocation && (
        <SitePicker
          latitude={lat}
          longitude={lng}
          radius={radius}
          onMove={moveTo}
          onName={(name) => setAddress((prev) => prev || name)}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="site-name">
            Site name *
          </label>
          <input
            id="site-name"
            name="name"
            required
            defaultValue={site?.name}
            placeholder="Head Office"
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="site-address">
            Address
          </label>
          {needsLocation ? (
            <AddressSearch
              id="site-address"
              value={address}
              onChange={setAddress}
              onPick={(r) => {
                setLat(r.latitude)
                setLng(r.longitude)
              }}
            />
          ) : (
            <input
              id="site-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Optional"
              className="field"
            />
          )}
          {/* The visible control is uncontrolled by the form, so mirror it. */}
          <input type="hidden" name="address" value={address} />
        </div>
      </div>

      {needsLocation && (
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="site-lat">
            Latitude
          </label>
          <input
            id="site-lat"
            type="number"
            step="any"
            min={-90}
            max={90}
            value={lat}
            onChange={(e) => setLat(Number(e.target.value))}
            className="field font-mono text-sm"
          />
        </div>
        <div>
          <label className="label" htmlFor="site-lng">
            Longitude
          </label>
          <input
            id="site-lng"
            type="number"
            step="any"
            min={-180}
            max={180}
            value={lng}
            onChange={(e) => setLng(Number(e.target.value))}
            className="field font-mono text-sm"
          />
        </div>
        <div>
          <label className="label" htmlFor="site-radius">
            Radius: {radius} m
          </label>
          <input
            id="site-radius"
            type="range"
            min={25}
            max={1000}
            step={25}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="w-full accent-[var(--primary)]"
          />
        </div>
      </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {needsLocation && (
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            className="btn btn-ghost btn-sm"
          >
            {locating ? <Spinner size={14} /> : <Crosshair size={14} />} Use my location
          </button>
        )}

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isActive"
            value="true"
            defaultChecked={site?.is_active ?? true}
            className="h-4 w-4 accent-[var(--primary)]"
          />
          Active
        </label>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onDone} className="btn btn-ghost">
          Cancel
        </button>
        <button type="submit" disabled={submitting} className="btn btn-primary">
          {submitting && <Spinner size={16} />} {site ? 'Save changes' : 'Create site'}
        </button>
      </div>
    </form>
  )
}
