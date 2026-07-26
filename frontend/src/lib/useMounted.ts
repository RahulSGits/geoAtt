'use client'

import { useSyncExternalStore } from 'react'

/** No client-side store to watch — the value only differs by environment. */
const noopSubscribe = () => () => {}

/**
 * `false` during SSR and the hydration pass, `true` afterwards.
 *
 * Used to defer rendering anything that depends on browser-only state (the
 * resolved theme, for example). `useSyncExternalStore` gives React the server
 * and client values directly, so there is no setState-in-effect and no extra
 * render cascade the way the classic `useState`+`useEffect` idiom has.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  )
}
