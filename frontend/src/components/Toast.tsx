'use client'

import { AnimatePresence, motion } from 'motion/react'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'
import { CheckCircle2, AlertTriangle, Info, X, XCircle } from 'lucide-react'

type ToastTone = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: number
  tone: ToastTone
  message: string
}

interface ToastApi {
  push: (tone: ToastTone, message: string) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
  warning: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

const toneMeta: Record<
  ToastTone,
  { icon: typeof CheckCircle2; color: string; soft: string }
> = {
  success: { icon: CheckCircle2, color: 'var(--success)', soft: 'var(--success-soft)' },
  error: { icon: XCircle, color: 'var(--danger)', soft: 'var(--danger-soft)' },
  warning: { icon: AlertTriangle, color: 'var(--warning)', soft: 'var(--warning-soft)' },
  info: { icon: Info, color: 'var(--info)', soft: 'var(--info-soft)' },
}

/** Errors stay up longer — they usually carry an instruction to act on. */
const DISMISS_MS: Record<ToastTone, number> = {
  success: 3200,
  info: 3600,
  warning: 5000,
  error: 6500,
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current++
      // Cap the stack so a burst of failures can't bury the whole viewport.
      setToasts((list) => [...list.slice(-3), { id, tone, message }])
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DISMISS_MS[tone]),
      )
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
      warning: (m) => push('warning', m),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        // Announced by screen readers without stealing focus.
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => {
            const meta = toneMeta[toast.tone]
            const Icon = meta.icon
            return (
              <motion.div
                key={toast.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 24, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                className="glass-strong pointer-events-auto flex items-start gap-3 p-3"
              >
                <span
                  className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg"
                  style={{ background: meta.soft, color: meta.color }}
                >
                  <Icon size={16} />
                </span>
                <p className="flex-1 pt-0.5 text-sm leading-snug">{toast.message}</p>
                <button
                  onClick={() => dismiss(toast.id)}
                  aria-label="Dismiss notification"
                  className="muted shrink-0 rounded-md p-1 transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)] cursor-pointer"
                >
                  <X size={15} />
                </button>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}
