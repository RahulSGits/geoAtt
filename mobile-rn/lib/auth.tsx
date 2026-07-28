import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth'

import { auth, isFirebaseConfigured, requireAuth } from './firebase'

type AuthState = {
  user: User | null
  /** False until Firebase has replayed persisted state — gates the first route. */
  ready: boolean
  signIn: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  resetPassword: (email: string) => Promise<void>
  logOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      // Nothing to wait for; let the UI render its "not configured" state.
      setReady(true)
      return
    }
    return onAuthStateChanged(auth, (next) => {
      setUser(next)
      setReady(true)
    })
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      signIn: async (email, password) => {
        await signInWithEmailAndPassword(requireAuth(), email.trim(), password)
      },
      register: async (name, email, password) => {
        const cred = await createUserWithEmailAndPassword(requireAuth(), email.trim(), password)
        if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() })
      },
      resetPassword: async (email) => {
        await sendPasswordResetEmail(requireAuth(), email.trim())
      },
      logOut: async () => {
        if (auth) await signOut(auth)
      },
    }),
    [user, ready],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

/**
 * Firebase error codes are stable but not readable. Anything unrecognised falls
 * back to a generic line rather than leaking `auth/internal-error` to a user.
 *
 * Sign-in failures deliberately do not distinguish "no such account" from
 * "wrong password" — that difference is an account-enumeration oracle.
 */
export function authErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address is not valid.'
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email or password is incorrect.'
    case 'auth/email-already-in-use':
      return 'An account already exists with that email.'
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Try again in a few minutes.'
    case 'auth/network-request-failed':
      return 'No connection. Check your network and try again.'
    default:
      return 'Something went wrong. Please try again.'
  }
}
