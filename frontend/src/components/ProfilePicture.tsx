'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { Camera, Trash2, Upload } from 'lucide-react'
import { Alert, Avatar, Spinner } from './ui'
import { useToast } from './Toast'
import { removeAvatar, uploadAvatar } from '@/app/(main)/avatar-actions'

/**
 * Profile picture panel for My Profile — the same control for employees, HR
 * and admins, since the storage path is keyed on the user id and knows nothing
 * about roles.
 *
 * Falls back to the initials Avatar when there is no picture, so a person who
 * never uploads one still renders correctly everywhere.
 */
export default function ProfilePicture({
  name,
  initialUrl,
}: {
  name: string
  /** Signed URL fetched on the server; null when they have no picture. */
  initialUrl: string | null
}) {
  const [url, setUrl] = useState<string | null>(initialUrl)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const toast = useToast()

  async function handleFile(file: File) {
    setBusy(true)
    setError(null)

    const fd = new FormData()
    fd.set('avatar', file)
    const res = await uploadAvatar(fd)

    if (res.ok) {
      // Cache-bust: the object path is stable, so the browser would otherwise
      // keep showing the previous picture.
      setUrl(res.data.url ? `${res.data.url}#${Date.now()}` : null)
      toast.success('Profile picture updated.')
    } else {
      setError(res.error)
    }
    setBusy(false)
  }

  async function handleRemove() {
    setBusy(true)
    setError(null)
    const res = await removeAvatar()
    if (res.ok) {
      setUrl(null)
      toast.success('Profile picture removed.')
    } else {
      setError(res.error)
    }
    setBusy(false)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          {url ? (
            <Image
              src={url}
              alt={`${name}'s profile picture`}
              width={72}
              height={72}
              unoptimized
              className="h-[72px] w-[72px] rounded-full object-cover"
              style={{ border: '2px solid var(--border)' }}
            />
          ) : (
            <Avatar name={name} size={72} />
          )}
          {busy && (
            <div className="absolute inset-0 grid place-items-center rounded-full bg-black/40">
              <Spinner size={18} />
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-2">
          <p className="muted text-xs">
            JPEG, PNG or WebP, up to 2 MB. Only you and your HR team can see it.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="btn btn-ghost btn-sm"
            >
              {url ? <Upload size={14} /> : <Camera size={14} />}
              {url ? 'Change picture' : 'Add picture'}
            </button>
            {url && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={busy}
                className="btn btn-ghost btn-sm"
              >
                <Trash2 size={14} /> Remove
              </button>
            )}
          </div>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Reset first, so choosing the same file twice still fires onChange.
          e.target.value = ''
          if (file) handleFile(file)
        }}
      />

      {error && <Alert tone="error">{error}</Alert>}
    </div>
  )
}
