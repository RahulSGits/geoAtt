import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useColorScheme } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { palettes, radius, shadows, type Palette, type Scheme } from './theme'

/**
 * Light/dark, matching the web app's next-themes behaviour.
 *
 * Three settings, not two: 'system' follows the OS and is the default, which is
 * what next-themes does on the web. A user who has never expressed a preference
 * should track their phone rather than be pinned to whatever we picked.
 *
 * The choice lives in AsyncStorage rather than SecureStore. It is a display
 * preference, not a credential, and the Keychain is the wrong place for it —
 * it would also survive an app reinstall, which is surprising for a theme.
 */
export type SchemePreference = Scheme | 'system'

const STORAGE_KEY = 'geoatt.scheme'

type ThemeState = {
  /** The scheme actually in effect, after resolving 'system'. */
  scheme: Scheme
  /** What the user chose, which may be 'system'. */
  preference: SchemePreference
  setPreference: (next: SchemePreference) => void
  colors: Palette
  shadow: { sm: string; md: string; lg: string }
  radius: typeof radius
}

const ThemeContext = createContext<ThemeState | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme()
  const [preference, setPreferenceState] = useState<SchemePreference>('system')

  // Restore the saved choice. Until it loads we render with 'system', which is
  // the default anyway — so there is no flash of the wrong theme for the
  // majority who never change it.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          setPreferenceState(saved)
        }
      })
      .catch(() => {
        // A missing or unreadable preference is not worth surfacing; 'system'
        // is a perfectly good answer.
      })
  }, [])

  const setPreference = useCallback((next: SchemePreference) => {
    setPreferenceState(next)
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {})
  }, [])

  const scheme: Scheme = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference

  const value = useMemo<ThemeState>(
    () => ({
      scheme,
      preference,
      setPreference,
      colors: palettes[scheme],
      shadow: shadows[scheme],
      radius,
    }),
    [scheme, preference, setPreference],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
