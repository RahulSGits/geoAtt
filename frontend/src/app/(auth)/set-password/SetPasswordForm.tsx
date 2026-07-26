'use client'

import { useState } from 'react'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import { setupPassword } from '../actions'
import { Alert, Spinner } from '@/components/ui'

const MIN_PASSWORD_LENGTH = 8

export default function SetPasswordForm() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  // One toggle per field: the eye lived only on the first box while the confirm
  // field silently followed it, so checking a typo in one revealed both.
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const mismatch = confirmPassword.length > 0 && password !== confirmPassword
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (mismatch || tooShort) return

    setLoading(true)
    setError(null)

    const result = await setupPassword(new FormData(e.currentTarget))
    // Success redirects, so anything returned here is a failure.
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
      {error && <Alert tone="error">{error}</Alert>}

      <div>
        <label className="label" htmlFor="password">
          New password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showNew ? 'text' : 'password'}
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={tooShort}
            aria-describedby="pw-help"
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
          id="pw-help"
          className="mt-1 text-xs"
          style={{ color: tooShort ? 'var(--danger)' : 'var(--text-muted)' }}
        >
          At least {MIN_PASSWORD_LENGTH} characters.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="confirmPassword">
          Confirm password
        </label>
        <div className="relative">
          <input
            id="confirmPassword"
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

      <button
        type="submit"
        disabled={loading || mismatch || tooShort}
        className="btn btn-primary w-full"
      >
        {loading ? <Spinner size={17} /> : <KeyRound size={16} />}
        Set password
      </button>
    </form>
  )
}
