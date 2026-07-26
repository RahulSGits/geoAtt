'use client'

import { useSyncExternalStore } from 'react'

/** Re-render every second while mounted. */
function subscribe(onChange: () => void) {
  const id = setInterval(onChange, 1000)
  return () => clearInterval(id)
}

const getSnapshot = () => Math.floor(Date.now() / 1000)
/** 0 marks "not on the client yet". */
const getServerSnapshot = () => 0

/**
 * Ticking date + time.
 *
 * Renders nothing on the server: its clock and timezone differ from the
 * browser's, so emitting a time on both sides guarantees a hydration mismatch.
 */
export default function LiveClock() {
  const seconds = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  if (seconds === 0) {
    // Reserve the line so the header doesn't shift when the clock appears.
    return <span className="inline-block h-5" />
  }

  const now = new Date(seconds * 1000)

  return (
    <span className="tabular-nums">
      {now.toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      })}
      {' · '}
      {now.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })}
    </span>
  )
}
