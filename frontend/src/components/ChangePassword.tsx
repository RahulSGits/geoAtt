'use client'

import { useState } from 'react'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import { changeOwnPassword } from '@/app/(auth)/actions'
import { Alert, Panel, Spinner } from './ui'

const MIN_PASSWORD_LENGTH = 8

/**
 * Self-service password change, shown in every profile.
 *
 * Everyone starts on the shared default password and gets exactly one change.
 * `firstLogin` is true while that change is still available; once spent, the
 * form closes and only an administrator's reset link reopens it. The same rule
 * is enforced server-side, so closing the form here is presentation, not the
 * control.
 */
export default function ChangePassword({ firstLogin = false }: { firstLogin?: boolean }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  // Independent per field: the eye sat only on the first box, so the confirm
  // field silently followed it with no control of its own. Someone checking a
  // typo in one should not have to reveal both.
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const mismatch = confirmPassword.length > 0 && password !== confirmPassword
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (mismatch || tooShort) return

    setSaving(true)
    setError(null)

    const res = await changeOwnPassword(new FormData(e.currentTarget))
    if (res?.error) {
      setError(res.error)
    } else {
      setDone(true)
      setPassword('')
      setConfirmPassword('')
      setCurrentPassword('')
      setShowCurrent(false)
      setShowNew(false)
      setShowConfirm(false)
    }
    setSaving(false)
  }

  return (
    <Panel title="Password" subtitle="Change the password you sign in with">
      {!firstLogin ? (
        <Alert tone="info">
          Your password has already been changed. If you need to change it again,
          ask an administrator to send you a reset link.
        </Alert>
      ) : done ? (
        <Alert tone="success">
          Password updated. Use the new one next time you sign in.
        </Alert>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <div>
              <label className="label" htmlFor="cp-current">
                Current password
              </label>
              <div className="relative">
                <input
                  id="cp-current"
                  name="currentPassword"
                  type={showCurrent ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                  className="field pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent((v) => !v)}
                  aria-label={showCurrent ? 'Hide current password' : 'Show current password'}
                  aria-pressed={showCurrent}
                  className="icon-btn absolute right-1 top-1/2 -translate-y-1/2"
                >
                  {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="muted mt-1 text-xs">
                You can change your password once. After that an administrator
                has to send you a reset link.
              </p>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="cp-password">
              New password
            </label>
            <div className="relative">
              <input
                id="cp-password"
                name="password"
                type={showNew ? 'text' : 'password'}
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={tooShort}
                placeholder="••••••••"
                className="field pr-11"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                aria-label={showNew ? 'Hide new password' : 'Show new password'}
                aria-pressed={showNew}
                className="icon-btn absolute right-1 top-1/2 -translate-y-1/2"
              >
                {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <p
              className="mt-1 text-xs"
              style={{ color: tooShort ? 'var(--danger)' : 'var(--text-muted)' }}
            >
              At least {MIN_PASSWORD_LENGTH} characters.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="cp-confirm">
              Confirm password
            </label>
            <div className="relative">
              <input
                id="cp-confirm"
                name="confirmPassword"
                type={showConfirm ? 'text' : 'password'}
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                aria-invalid={mismatch}
                placeholder="••••••••"
                className="field pr-11"
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                aria-label={showConfirm ? 'Hide confirmation' : 'Show confirmation'}
                aria-pressed={showConfirm}
                className="icon-btn absolute right-1 top-1/2 -translate-y-1/2"
              >
                {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {mismatch && (
              <p role="alert" className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>
                Passwords do not match.
              </p>
            )}
          </div>

          {error && <Alert tone="error">{error}</Alert>}

          <button
            type="submit"
            disabled={saving || mismatch || tooShort || !password || !currentPassword}
            className="btn btn-primary"
          >
            {saving ? <Spinner size={16} /> : <KeyRound size={16} />} Update password
          </button>
        </form>
      )}
    </Panel>
  )
}
