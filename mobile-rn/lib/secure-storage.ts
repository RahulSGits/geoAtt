import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'

/**
 * Encrypted session storage for the Supabase client.
 *
 * AsyncStorage — the usual choice, and what this replaced — is a plaintext
 * file in the app's sandbox. On a rooted or jailbroken device that is a
 * readable refresh token, which is a live credential for someone's attendance
 * record. SecureStore puts it in the iOS Keychain and Android Keystore.
 *
 * CHUNKING IS NOT OPTIONAL
 *
 * SecureStore warns above 2048 bytes and can fail outright on Android, where
 * the limit is enforced by the Keystore rather than advisory. A Supabase
 * session — access token, refresh token, and the user object with its metadata
 * — is comfortably larger than that. Storing it whole works in simulators and
 * then fails on real hardware for users with longer claims, which is the worst
 * possible place to find out.
 *
 * So a value is split across `key.0`, `key.1`, … with a small index at `key`
 * recording the count. Reads reassemble; writes replace; removes clean up every
 * chunk, including ones left by a previously longer value.
 */

const CHUNK_SIZE = 1800 // headroom under the 2048-byte limit
const INDEX_PREFIX = '__chunks:'

/**
 * On web there is no Keychain. localStorage is what the browser build of
 * Supabase uses anyway, and it is the same trust boundary as the rest of the
 * page — no worse than the web app the user already signs into.
 */
const isWeb = Platform.OS === 'web'

async function rawGet(key: string): Promise<string | null> {
  if (isWeb) return globalThis.localStorage?.getItem(key) ?? null
  return SecureStore.getItemAsync(key)
}

async function rawSet(key: string, value: string): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.setItem(key, value)
    return
  }
  await SecureStore.setItemAsync(key, value)
}

async function rawRemove(key: string): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.removeItem(key)
    return
  }
  await SecureStore.deleteItemAsync(key)
}

/** How many chunks the stored value occupies, or 0 if it is not chunked. */
async function chunkCount(key: string): Promise<number> {
  const head = await rawGet(key)
  if (!head?.startsWith(INDEX_PREFIX)) return 0
  const n = Number(head.slice(INDEX_PREFIX.length))
  return Number.isFinite(n) && n > 0 ? n : 0
}

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const count = await chunkCount(key)
    if (count === 0) return rawGet(key)

    const parts = await Promise.all(
      Array.from({ length: count }, (_, i) => rawGet(`${key}.${i}`)),
    )
    // A missing chunk means a partial write or a partial wipe. Returning half a
    // session would have Supabase fail in confusing ways; treating it as absent
    // just signs the user in again.
    if (parts.some((p) => p === null)) return null
    return parts.join('')
  },

  async setItem(key: string, value: string): Promise<void> {
    // Clear whatever was there first, so shrinking from 3 chunks to 1 does not
    // leave chunk 2 behind for the next read to trip over.
    await secureStorage.removeItem(key)

    if (value.length <= CHUNK_SIZE) {
      await rawSet(key, value)
      return
    }

    const chunks: string[] = []
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE))
    }

    // Chunks first, index last: if the write is interrupted, no index means
    // getItem falls back to rawGet and returns null rather than assembling a
    // truncated session.
    await Promise.all(chunks.map((c, i) => rawSet(`${key}.${i}`, c)))
    await rawSet(key, `${INDEX_PREFIX}${chunks.length}`)
  },

  async removeItem(key: string): Promise<void> {
    const count = await chunkCount(key)
    if (count > 0) {
      await Promise.all(
        Array.from({ length: count }, (_, i) => rawRemove(`${key}.${i}`)),
      )
    }
    await rawRemove(key)
  },
}
