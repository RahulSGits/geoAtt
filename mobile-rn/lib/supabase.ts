import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState, Platform } from 'react-native'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * The Supabase client — the same project the web app uses, so an account
 * provisioned by HR on the web signs straight into the phone app.
 *
 * Config comes from EXPO_PUBLIC_* variables, which Expo inlines at build time.
 * These are not secrets: the publishable key ships inside every client binary
 * by design. Row Level Security is what protects the data — never put the
 * service-role key anywhere near this app.
 */
const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY

/** True once both values are present — the UI uses this to explain itself. */
export const isSupabaseConfigured = Boolean(url && key)

/**
 * Null until configured, and deliberately so.
 *
 * `createClient('' , ...)` throws synchronously at module scope, which takes
 * down the whole render tree — a fresh clone with no .env would show a white
 * screen instead of the "not configured" notice on the sign-in card. (The
 * Firebase client this replaced had the identical failure mode, found the
 * hard way.) Failing soft here is what lets that notice render at all.
 */
let client: SupabaseClient | null = null

if (isSupabaseConfigured) {
  client = createClient(url!, key!, {
    auth: {
      // On native, sessions must be persisted through AsyncStorage or the user
      // is signed out on every cold start. On web the default localStorage
      // layer is already correct, and detectSessionInUrl lets password-reset
      // links complete.
      ...(Platform.OS === 'web' ? {} : { storage: AsyncStorage }),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: Platform.OS === 'web',
    },
  })

  if (Platform.OS !== 'web') {
    // Refresh tokens only while the app is foregrounded — the pattern from
    // Supabase's own React Native guide. In the background the timer would be
    // frozen mid-cycle anyway; stopping it makes resume deterministic.
    AppState.addEventListener('change', (state) => {
      if (state === 'active') client!.auth.startAutoRefresh()
      else client!.auth.stopAutoRefresh()
    })
  }
}

export const supabase = client

/**
 * Narrowing helper for call sites that genuinely need the client. The message
 * is aimed at whoever is setting the project up, not at an end user.
 */
export function requireSupabase(): SupabaseClient {
  if (!client) {
    throw new Error(
      'Supabase is not configured. Copy mobile-rn/.env.example to .env and fill in the project URL and publishable key.',
    )
  }
  return client
}
