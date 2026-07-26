'use client'

import { motion } from 'motion/react'
import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Eye, EyeOff, Fingerprint, MapPin, ScanFace, ShieldCheck } from 'lucide-react'
import { login } from '../actions'
import { Alert, Spinner } from '@/components/ui'

const HIGHLIGHTS = [
  { icon: ScanFace, text: 'Face-verified check-in with a liveness gate' },
  { icon: MapPin, text: 'Geofenced work sites, validated server-side' },
  { icon: ShieldCheck, text: 'Row-level security on every record' },
]

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const res = await login(new FormData(e.currentTarget))
    // A successful login redirects, so reaching here always means a failure.
    if (res?.error) {
      setError(res.error)
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-dvh">
      <div className="flex w-full flex-col justify-center px-4 py-10 sm:px-10 lg:w-1/2 lg:px-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mx-auto w-full max-w-sm"
        >
          <Link href="/" className="mb-8 inline-flex items-center gap-2">
            <span
              className="grid h-9 w-9 place-items-center rounded-xl"
              style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
            >
              <Fingerprint size={19} />
            </span>
            <span className="font-semibold">FinAtt</span>
          </Link>

          <h1 className="text-3xl font-bold tracking-tight">Welcome back</h1>
          <p className="muted mt-2">Sign in to your FinAtt dashboard.</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            {error && <Alert tone="error">{error}</Alert>}

            <div>
              <label className="label" htmlFor="email">
                Email or employee ID
              </label>
              <input
                id="email"
                name="email"
                type="text"
                autoComplete="username"
                required
                placeholder="you@company.com or EMP-0001"
                className="field"
              />
              <p className="muted mt-1 text-xs">
                Employees can sign in with their employee ID.
              </p>
            </div>

            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  className="field pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="icon-btn absolute right-1 top-1/2 -translate-y-1/2"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn btn-primary w-full">
              {loading ? (
                <Spinner size={17} />
              ) : (
                <>
                  Sign in <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>

          <p className="muted mt-6 text-center text-sm">
            Accounts are created by your HR team. If you cannot sign in, ask them
            to send you an invite.
          </p>
        </motion.div>
      </div>

      {/* Marketing rail — decorative, hidden on small screens */}
      <div
        className="relative hidden overflow-hidden lg:flex lg:w-1/2 lg:flex-col lg:justify-end"
        style={{ background: 'var(--surface-2)' }}
      >
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(60% 50% at 20% 20%, var(--primary-soft), transparent 60%), radial-gradient(55% 45% at 85% 80%, var(--accent-soft), transparent 60%)',
          }}
        />
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.5 }}
          className="relative p-14"
        >
          <h2 className="text-3xl font-bold leading-tight">
            Attendance that
            <br />
            <span className="gradient-text">actually verifies.</span>
          </h2>
          <ul className="mt-8 space-y-4">
            {HIGHLIGHTS.map((h) => (
              <li key={h.text} className="flex items-start gap-3">
                <span
                  className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg"
                  style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
                >
                  <h.icon size={16} />
                </span>
                <span className="muted">{h.text}</span>
              </li>
            ))}
          </ul>
        </motion.div>
      </div>
    </div>
  )
}
