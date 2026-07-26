'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Loader2, MapPin, Search } from 'lucide-react'
import type { GeocodeResult } from '@/app/api/geocode/route'

/** Long enough that a typist isn't firing a lookup per keystroke. */
const DEBOUNCE_MS = 600
/** Below this, a query matches half the planet and isn't worth sending. */
const MIN_QUERY = 3

/**
 * Address field that geocodes as you type and reports the chosen coordinates.
 *
 * Implemented as a combobox so the suggestion list is reachable by keyboard and
 * announced by screen readers, rather than a mouse-only dropdown.
 */
export default function AddressSearch({
  value,
  onChange,
  onPick,
  placeholder = 'Start typing an address…',
  id,
}: {
  value: string
  onChange: (value: string) => void
  onPick: (result: GeocodeResult) => void
  placeholder?: string
  id?: string
}) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const listId = `${inputId}-listbox`

  const [results, setResults] = useState<GeocodeResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [noMatches, setNoMatches] = useState(false)
  const [active, setActive] = useState(-1)

  const boxRef = useRef<HTMLDivElement>(null)
  // Set when a suggestion is chosen, so echoing its label back into the input
  // doesn't immediately trigger another search for the same place.
  const skipNextSearch = useRef(false)

  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false
      return
    }

    // No setState here: clearing synchronously in the effect body triggers a
    // cascading render. Too-short queries are hidden at render time instead,
    // via `tooShort` below.
    const query = value.trim()
    if (query.length < MIN_QUERY) return

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        })
        const body = await res.json()

        if (!res.ok) {
          setError(body?.error ?? 'Address lookup failed.')
          setResults([])
          setNoMatches(false)
        } else {
          const found: GeocodeResult[] = body.results ?? []
          setResults(found)
          setOpen(found.length > 0)
          setNoMatches(found.length === 0)
          setActive(-1)
        }
      } catch (err) {
        // An aborted request is the expected outcome of typing another key.
        if (!(err instanceof Error && err.name === 'AbortError')) {
          setError('Could not reach the address lookup.')
        }
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [value])

  // Dismiss the list when focus or the pointer leaves the widget.
  useEffect(() => {
    if (!open) return
    const onDocPointerDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDocPointerDown)
    return () => document.removeEventListener('pointerdown', onDocPointerDown)
  }, [open])

  function choose(result: GeocodeResult) {
    skipNextSearch.current = true
    onChange(result.label)
    onPick(result)
    setOpen(false)
    setActive(-1)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!showList) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1))
    } else if (e.key === 'Enter' && active >= 0) {
      // Only swallow Enter when a suggestion is highlighted, so the form can
      // still be submitted normally otherwise.
      e.preventDefault()
      choose(results[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  // Derived rather than stored, so shortening the query hides the list without
  // an extra state write.
  const tooShort = value.trim().length < MIN_QUERY
  const showList = open && !tooShort && results.length > 0
  const showNoMatch = noMatches && !tooShort && !loading && !error

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search
          size={15}
          className="muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
        />
        <input
          id={inputId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => !tooShort && results.length > 0 && setOpen(true)}
          placeholder={placeholder}
          className="field pl-9 pr-9"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
        />
        {loading && (
          <Loader2
            size={15}
            className="muted absolute right-3 top-1/2 -translate-y-1/2 animate-spin"
          />
        )}
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="glass-strong absolute z-[60] mt-1 max-h-60 w-full overflow-y-auto p-1"
        >
          {results.map((result, i) => (
            <li key={`${result.latitude},${result.longitude},${i}`}>
              <button
                id={`${listId}-${i}`}
                type="button"
                role="option"
                aria-selected={i === active}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(result)}
                onMouseEnter={() => setActive(i)}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors cursor-pointer"
                style={{ background: i === active ? 'var(--surface-2)' : 'transparent' }}
              >
                <MapPin
                  size={14}
                  className="mt-0.5 shrink-0"
                  style={{ color: 'var(--primary)' }}
                />
                <span className="min-w-0 flex-1">{result.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      {/* OpenStreetMap has no data for most building-level addresses, so an
          over-specific query legitimately returns nothing. Say so, and say what
          to do about it, rather than rendering an empty box. */}
      {showNoMatch && (
        <p className="mt-1 text-xs" style={{ color: 'var(--warning)' }}>
          No match. Try a shorter address — street, area and city usually work
          (&ldquo;Sector 7, Noida&rdquo;), then drag the pin to the exact spot.
        </p>
      )}

      {!showNoMatch && !error && (
        <p className="muted mt-1 text-xs">
          Pick a suggestion to drop the pin, or click the map to adjust it.
        </p>
      )}
    </div>
  )
}
