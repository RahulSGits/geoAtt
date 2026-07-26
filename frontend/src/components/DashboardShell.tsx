'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Bell, Fingerprint, LogOut, Menu, Moon, Sun, X } from 'lucide-react'
import { useTheme } from 'next-themes'
import AIChatWidget from './AIChatWidget'
import { logout } from '@/app/(auth)/actions'
import { relativeTime } from '@/lib/format'
import { useMounted } from '@/lib/useMounted'

export interface NavItem {
  key: string
  label: string
  icon: React.ComponentType<{ size?: number }>
  /** Rendered as a count chip on the nav item, e.g. pending approvals. */
  badge?: number
}

export interface UserProfile {
  id: string
  name: string
  role: string
}

/** Dot colour per notification kind, matching the app's status palette. */
const TONE_COLORS: Record<string, string> = {
  info: 'var(--primary)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  error: 'var(--danger)',
}

export interface Notification {
  id: string
  title: string
  body: string
  createdAt: string
  tone?: 'info' | 'success' | 'warning'
  /** False until the recipient opens the panel. Drives the unread badge. */
  seen?: boolean
}

export default function DashboardShell({
  nav,
  active,
  onSelect,
  userProfile,
  notifications = [],
  unseenCount,
  onNotificationsOpen,
  children,
}: {
  nav: NavItem[]
  active: string
  onSelect: (key: string) => void
  userProfile: UserProfile
  notifications?: Notification[]
  /** Overrides the badge count; defaults to unseen-or-all. */
  unseenCount?: number
  /** Called when the panel opens, so the parent can mark everything seen. */
  onNotificationsOpen?: () => void
  children: React.ReactNode
}) {
  const [sideOpen, setSideOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useMounted()

  // Close the mobile drawer when the viewport grows past the breakpoint,
  // otherwise it stays mounted and traps clicks behind the desktop sidebar.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const onChange = () => mq.matches && setSideOpen(false)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Prefer an explicit count; otherwise derive from the seen flags, and finally
  // fall back to total for callers still passing plain lists.
  const badgeCount =
    unseenCount ??
    (notifications.some((n) => n.seen !== undefined)
      ? notifications.filter((n) => !n.seen).length
      : notifications.length)

  const roleLabel =
    userProfile.role === 'admin'
      ? 'Admin Console'
      : userProfile.role === 'hr'
        ? 'HR Console'
        : 'Employee Portal'
  const isDark = resolvedTheme === 'dark'

  async function handleLogout() {
    setSigningOut(true)
    await logout()
  }

  return (
    <div className="flex min-h-screen">
      {/* ── Mobile drawer ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {sideOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSideOpen(false)}
              className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm md:hidden dark:bg-black/60"
            />
            <motion.aside
              initial={{ x: -288 }}
              animate={{ x: 0 }}
              exit={{ x: -288 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed left-0 top-0 z-50 flex h-dvh w-72 flex-col border-r border-[var(--border)] bg-[var(--surface)] p-3 md:hidden"
            >
              <button
                onClick={() => setSideOpen(false)}
                aria-label="Close menu"
                className="muted absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-lg hover:bg-[var(--surface-2)] cursor-pointer"
              >
                <X size={18} />
              </button>
              <SidebarContent
                nav={nav}
                active={active}
                onSelect={(k) => {
                  onSelect(k)
                  setSideOpen(false)
                }}
                roleLabel={roleLabel}
                onLogout={handleLogout}
                signingOut={signingOut}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ── Desktop sidebar ────────────────────────────────────────────── */}
      <aside
        className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-[var(--border)] p-3 md:flex"
        style={{
          background: 'var(--sidebar-bg)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
        }}
      >
        <SidebarContent
          nav={nav}
          active={active}
          onSelect={onSelect}
          roleLabel={roleLabel}
          onLogout={handleLogout}
          signingOut={signingOut}
        />
      </aside>

      {/* ── Main column ────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-30 flex items-center gap-2 border-b border-[var(--border)] px-3 py-2.5 sm:px-4"
          style={{
            background: 'var(--header-bg)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
          }}
        >
          <button
            onClick={() => setSideOpen(true)}
            aria-label="Open menu"
            className="touch-target rounded-lg bg-[var(--surface-2)] md:hidden cursor-pointer"
          >
            <Menu size={18} />
          </button>

          <div className="flex min-w-0 items-center gap-2">
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-bold"
              style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
            >
              FA
            </span>
            <div className="hidden min-w-0 sm:block">
              <div className="truncate text-sm font-semibold leading-tight">FinAtt</div>
              <div className="muted truncate text-xs">{roleLabel}</div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <AIChatWidget userProfile={userProfile} />

            {mounted && (
              <button
                onClick={() => setTheme(isDark ? 'light' : 'dark')}
                aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
                className="touch-target muted rounded-lg transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)] cursor-pointer"
              >
                {isDark ? <Sun size={18} /> : <Moon size={18} />}
              </button>
            )}

            <div className="relative">
              <button
                onClick={() => {
                  const next = !notifOpen
                  setNotifOpen(next)
                  // Mark seen when opening, matching the "clicking the button
                  // marks as seen" behaviour.
                  if (next) onNotificationsOpen?.()
                }}
                aria-label={`Notifications${badgeCount ? `, ${badgeCount} unread` : ''}`}
                aria-expanded={notifOpen}
                className="touch-target muted relative rounded-lg transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)] cursor-pointer"
              >
                <Bell size={18} />
                {badgeCount > 0 && (
                  <span
                    className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
                    style={{ background: 'var(--danger)' }}
                  >
                    {badgeCount > 9 ? '9+' : badgeCount}
                  </span>
                )}
              </button>

              <AnimatePresence>
                {notifOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setNotifOpen(false)}
                      aria-hidden
                    />
                    <motion.div
                      initial={{ opacity: 0, y: -8, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.97 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                      className="glass-strong absolute right-0 z-50 mt-2 flex max-h-[70vh] w-[min(22rem,calc(100vw-2rem))] origin-top-right flex-col overflow-hidden"
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
                        <span className="text-sm font-semibold">
                          Notifications
                          {badgeCount > 0 && (
                            <span className="muted ml-1.5 font-normal">
                              ({badgeCount} new)
                            </span>
                          )}
                        </span>
                        {badgeCount > 0 && onNotificationsOpen && (
                          <button
                            onClick={() => onNotificationsOpen()}
                            className="text-xs font-medium transition-opacity hover:opacity-70 cursor-pointer"
                            style={{ color: 'var(--primary)' }}
                          >
                            Mark all read
                          </button>
                        )}
                      </div>
                      {notifications.length === 0 ? (
                        <div className="muted flex flex-col items-center gap-2 py-10 text-sm">
                          <Bell size={22} className="opacity-30" />
                          You&apos;re all caught up
                        </div>
                      ) : (
                        <ul className="divide-y divide-[var(--border)] overflow-y-auto">
                          {notifications.map((n) => {
                            const unread = n.seen === false
                            return (
                              <li
                                key={n.id}
                                className="flex gap-2.5 px-4 py-3"
                                style={
                                  unread ? { background: 'var(--primary-soft)' } : undefined
                                }
                              >
                                <span
                                  aria-hidden
                                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                                  style={{
                                    background: unread
                                      ? TONE_COLORS[n.tone ?? 'info']
                                      : 'transparent',
                                  }}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-start justify-between gap-2">
                                    <p className="text-sm font-medium">{n.title}</p>
                                    <span className="muted shrink-0 text-[11px]">
                                      {relativeTime(n.createdAt)}
                                    </span>
                                  </div>
                                  {n.body && (
                                    <p className="muted mt-0.5 line-clamp-3 text-xs">
                                      {n.body}
                                    </p>
                                  )}
                                </div>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            <div className="flex items-center gap-2 pl-1">
              <span
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
                style={{ background: 'linear-gradient(135deg,#4f46e5,#a855f7)' }}
                aria-hidden
              >
                {userProfile.name
                  .split(' ')
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase()}
              </span>
              <div className="hidden min-w-0 lg:block">
                <div className="truncate text-sm font-medium leading-tight">
                  {userProfile.name}
                </div>
                <div className="muted text-xs capitalize">{userProfile.role}</div>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 p-3 sm:p-5">{children}</main>
      </div>
    </div>
  )
}

function SidebarContent({
  nav,
  active,
  onSelect,
  roleLabel,
  onLogout,
  signingOut,
}: {
  nav: NavItem[]
  active: string
  onSelect: (key: string) => void
  roleLabel: string
  onLogout: () => void
  signingOut: boolean
}) {
  return (
    <>
      <div className="mb-5 flex items-center gap-2 px-2 pt-2">
        <span
          className="grid h-9 w-9 place-items-center rounded-xl"
          style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
        >
          <Fingerprint size={19} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold leading-tight">FinAtt</div>
          <div className="muted truncate text-xs">{roleLabel}</div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto" aria-label="Sections">
        {nav.map((item) => {
          const Icon = item.icon
          const on = active === item.key
          return (
            <button
              key={item.key}
              onClick={() => onSelect(item.key)}
              aria-current={on ? 'page' : undefined}
              // The label sits in a nested span behind an absolutely-positioned
              // highlight; naming the button explicitly keeps screen readers
              // from announcing it as an unlabelled control.
              aria-label={item.badge ? `${item.label}, ${item.badge} pending` : item.label}
              className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors cursor-pointer ${
                on
                  ? 'font-medium text-[var(--primary)]'
                  : 'muted hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
              }`}
            >
              {on && (
                <motion.span
                  layoutId="nav-active"
                  className="absolute inset-0 rounded-lg"
                  style={{
                    background: 'var(--primary-soft)',
                    border: '1px solid color-mix(in srgb, var(--primary) 30%, transparent)',
                  }}
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
              <Icon size={17} />
              <span className="relative flex-1 text-left">{item.label}</span>
              {item.badge ? (
                <span
                  className="relative rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                  style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
                >
                  {item.badge}
                </span>
              ) : null}
            </button>
          )
        })}
      </nav>

      <button
        onClick={onLogout}
        disabled={signingOut}
        className="muted mt-2 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)] disabled:opacity-60 cursor-pointer"
      >
        <LogOut size={17} />
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </>
  )
}
