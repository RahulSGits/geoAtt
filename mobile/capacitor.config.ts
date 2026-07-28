import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The native shells render the *deployed* Next.js app — they do not bundle it.
 *
 * FinAtt cannot be statically exported: it runs on Server Actions, SSR and
 * `src/proxy.ts` role routing, all of which need a live Node server. So the
 * WebView is pointed at whichever origin is already serving the website, and
 * app + web stay one codebase against one Supabase project by construction.
 *
 * The URL is read from `mobile/.env` (gitignored) or the environment, so the
 * same checkout builds a LAN-dev app and a store app without an edit.
 */
function appUrl(): string | undefined {
  const fromEnv = process.env.FINATT_APP_URL?.trim()
  if (fromEnv) return fromEnv

  try {
    const env = readFileSync(resolve(__dirname, '.env'), 'utf8')
    for (const line of env.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      if (trimmed.slice(0, eq).trim() !== 'FINATT_APP_URL') continue
      // Tolerate FINATT_APP_URL="https://…" as well as the bare form.
      return trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '') || undefined
    }
  } catch {
    // No .env — fall through to the bundled placeholder page.
  }
  return undefined
}

const url = appUrl()
const isCleartext = url?.startsWith('http://') ?? false

const config: CapacitorConfig = {
  appId: 'com.finatt.app',
  appName: 'FinAtt',

  // Required by the CLI even when a remote `server.url` is set. It holds the
  // placeholder page that shows if FINATT_APP_URL was never configured, which
  // is a far better failure than a silent white screen.
  webDir: 'www',

  server: url
    ? {
        url,
        // Only relaxes http for the LAN-dev case; an https URL leaves TLS enforced.
        cleartext: isCleartext,
        androidScheme: isCleartext ? 'http' : 'https',
      }
    : undefined,

  ios: {
    // Camera preview must render in the page, not take over the screen.
    // Without this the check-in <video> refuses to play inline on iOS.
    limitsNavigationsToAppBoundDomains: false,
    contentInset: 'always',
  },

  android: {
    // Face weights are large and content-stable; let the WebView keep them
    // across launches instead of refetching 38 MB on every cold start.
    webContentsDebuggingEnabled: false,
    allowMixedContent: isCleartext,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#0b1220',
      showSpinner: false,
      androidSplashResourceName: 'splash',
    },
    Keyboard: {
      resize: 'native',
    },
  },
}

export default config
