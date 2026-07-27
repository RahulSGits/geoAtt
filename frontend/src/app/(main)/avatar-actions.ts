'use server'

import { revalidatePath } from 'next/cache'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { AuthError, requireSession } from '@/lib/auth'
import type { ActionResult } from '@/lib/types'

/**
 * Profile pictures, for every role.
 *
 * Two design notes worth knowing before changing this:
 *
 * 1. There is no `avatar_url` column. The object path is derived from the
 *    user's id (`<uid>.jpg`), so the picture needs no schema change and cannot
 *    drift out of sync with the row. Adding a column would have meant a
 *    migration this deployment has not run.
 *
 * 2. The bucket is PRIVATE and has no RLS policies, so it is reachable only
 *    with the service key — which means every read and write goes through these
 *    server actions. Reads are handed out as short-lived signed URLs rather
 *    than by making the bucket public: these are photographs of staff.
 *
 * Face enrollment does NOT produce a picture. It stores a 128-float descriptor
 * and deliberately never keeps the frame, so there is no enrollment photo to
 * reuse here — the picture is uploaded by the person themselves.
 */

const BUCKET = 'avatars'
const MAX_BYTES = 2 * 1024 * 1024
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']
/** Long enough to render a page, short enough that a leaked URL dies quickly. */
const SIGNED_URL_TTL_SECONDS = 60 * 60

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function fail(error: string): ActionResult<never> {
  return { ok: false, error }
}

/** Extension is fixed per content type so one person has exactly one object. */
function objectPath(userId: string): string {
  return `${userId}.jpg`
}

/**
 * Replace the signed-in user's profile picture.
 *
 * Scoped to the caller's own id — the path is derived from the session, never
 * from the form — so this cannot be pointed at somebody else's picture.
 */
export async function uploadAvatar(formData: FormData): Promise<ActionResult<{ url: string }>> {
  try {
    const session = await requireSession()

    const file = formData.get('avatar')
    if (!(file instanceof File) || file.size === 0) {
      return fail('Choose an image first.')
    }
    if (file.size > MAX_BYTES) {
      return fail('That image is larger than 2 MB. Choose a smaller one.')
    }
    if (!ALLOWED.includes(file.type)) {
      return fail('Use a JPEG, PNG or WebP image.')
    }

    const client = admin()
    if (!client) {
      return fail('Profile pictures are not configured on this deployment yet.')
    }

    const { error } = await client.storage
      .from(BUCKET)
      .upload(objectPath(session.userId), file, {
        upsert: true,
        contentType: file.type,
      })

    if (error) {
      console.error('[uploadAvatar]', error.message)
      return fail('Could not save that image. Please try again.')
    }

    const url = await signedAvatarUrl(session.userId)
    revalidatePath('/employee')
    revalidatePath('/hr')
    revalidatePath('/admin')
    return { ok: true, data: { url: url ?? '' } }
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message)
    console.error('[uploadAvatar]', err)
    return fail('Something went wrong.')
  }
}

/** Remove the signed-in user's picture. */
export async function removeAvatar(): Promise<ActionResult> {
  try {
    const session = await requireSession()
    const client = admin()
    if (!client) return fail('Profile pictures are not configured on this deployment yet.')

    const { error } = await client.storage.from(BUCKET).remove([objectPath(session.userId)])
    if (error) {
      console.error('[removeAvatar]', error.message)
      return fail('Could not remove that image.')
    }

    revalidatePath('/employee')
    revalidatePath('/hr')
    revalidatePath('/admin')
    return { ok: true }
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message)
    return fail('Something went wrong.')
  }
}

/**
 * A signed URL for one person's picture, or null when they have none.
 *
 * Exported for server components that render someone else's avatar (the HR
 * directory), which is why it takes an id rather than reading the session.
 * Returns null rather than throwing: a missing picture is not an error, and
 * every caller falls back to initials.
 */
export async function signedAvatarUrl(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null
  const client = admin()
  if (!client) return null

  try {
    const { data, error } = await client.storage
      .from(BUCKET)
      .createSignedUrl(objectPath(userId), SIGNED_URL_TTL_SECONDS)
    if (error) return null
    return data?.signedUrl ?? null
  } catch {
    return null
  }
}

/** The signed-in user's own picture. */
export async function myAvatarUrl(): Promise<string | null> {
  try {
    const session = await requireSession()
    return await signedAvatarUrl(session.userId)
  } catch {
    return null
  }
}
