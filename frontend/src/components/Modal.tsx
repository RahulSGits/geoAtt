'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

/**
 * Accessible dialog: closes on Escape and backdrop click, traps Tab inside the
 * panel, and restores focus to whatever opened it.
 */
export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreFocusTo = useRef<HTMLElement | null>(null)

  /**
   * Held in a ref so the effect below can depend on `open` alone.
   *
   * Callers write `onClose={() => setThing(false)}`, which is a new function on
   * every render. With `onClose` in the dependency array the effect tore down
   * and re-ran on *every* keystroke in a dialog whose input state lives in the
   * parent — restoring focus to the opener, then pulling it to the first
   * focusable element. The visible symptom was a confirmation field that
   * accepted one character and then lost focus, which made typed-name and
   * password confirmations impossible to complete.
   */
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return

    restoreFocusTo.current = document.activeElement as HTMLElement | null

    // Stop the page behind the dialog from scrolling.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusable = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      )

    focusable()[0]?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return

      const items = focusable()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      restoreFocusTo.current?.focus()
    }
  }, [open])

  const maxWidth = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  }[size]

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm dark:bg-black/60"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            aria-describedby={description ? 'modal-description' : undefined}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className={`glass-strong relative flex max-h-[92vh] w-full ${maxWidth} flex-col rounded-b-none sm:rounded-b-2xl`}
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] p-4">
              <div className="min-w-0">
                <h2 id="modal-title" className="text-base font-semibold">
                  {title}
                </h2>
                {description && (
                  <p id="modal-description" className="muted mt-1 text-sm">
                    {description}
                  </p>
                )}
              </div>
              <button
                onClick={onClose}
                aria-label="Close dialog"
                className="muted -mr-1 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)] cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
