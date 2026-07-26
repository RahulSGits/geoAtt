'use client'

import { AnimatePresence, motion } from 'motion/react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Send, Sparkles, X } from 'lucide-react'
import { Spinner } from './ui'
import { useMounted } from '@/lib/useMounted'

interface Message {
  id: string
  role: 'user' | 'ai'
  content: string
}

const PROMPTS: Record<string, string[]> = {
  hr: [
    'Who is absent today?',
    'Which department has the lowest attendance?',
    'How many employees have not enrolled their face?',
    'Summarise this month for me.',
  ],
  employee: [
    'What is my attendance percentage?',
    'How many leaves have I taken?',
    'What shift am I on?',
  ],
}

export default function AIChatWidget({
  userProfile,
}: {
  userProfile?: { role: string }
}) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const mounted = useMounted()
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Admin is a superset of HR everywhere else in the app, so it gets the HR
  // prompts too. Matching only 'hr' showed an administrator the employee
  // suggestions ("When did I check in today?") against a roster-wide context.
  const role = userProfile?.role === 'hr' || userProfile?.role === 'admin' ? 'hr' : 'employee'
  const prompts = PROMPTS[role]

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || thinking) return

    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', content: trimmed },
    ])
    setInput('')
    setThinking(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No role is sent: the route reads it from the caller's profile, so a
        // value from here would be ignored anyway.
        body: JSON.stringify({ message: trimmed }),
      })
      const data = await res.json()

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'ai',
          content:
            data.response ||
            (data.error
              ? `I could not answer that: ${data.error}`
              : "Sorry, I couldn't work that out."),
        },
      ])
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'ai',
          content: 'I could not reach the server. Check your connection and try again.',
        },
      ])
    } finally {
      setThinking(false)
    }
  }

  if (!userProfile) return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Ask FinAtt AI"
        className="touch-target rounded-lg transition-colors cursor-pointer"
        style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
      >
        <Sparkles size={17} />
      </button>

      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setOpen(false)}
                  className="fixed inset-0 z-[80] bg-slate-900/30 backdrop-blur-sm sm:hidden"
                />
                <motion.div
                  role="dialog"
                  aria-label="FinAtt AI assistant"
                  initial={{ opacity: 0, y: 20, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 20, scale: 0.97 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  className="glass-strong fixed inset-x-3 bottom-3 z-[85] flex h-[70vh] flex-col overflow-hidden sm:inset-x-auto sm:bottom-5 sm:right-5 sm:h-[520px] sm:w-[380px]"
                >
                  <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="grid h-8 w-8 place-items-center rounded-full"
                        style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
                      >
                        <Sparkles size={15} />
                      </span>
                      <div>
                        <h3 className="text-sm font-semibold">FinAtt AI</h3>
                        <p className="text-[11px]" style={{ color: 'var(--success)' }}>
                          Connected to your live data
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setOpen(false)}
                      aria-label="Close assistant"
                      className="muted touch-target rounded-lg transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)] cursor-pointer"
                    >
                      <X size={17} />
                    </button>
                  </header>

                  <div className="flex-1 overflow-y-auto p-4">
                    {messages.length === 0 ? (
                      <div className="flex h-full flex-col items-center justify-center text-center">
                        <span
                          className="mb-3 grid h-12 w-12 place-items-center rounded-full"
                          style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
                        >
                          <Sparkles size={22} />
                        </span>
                        <h4 className="text-sm font-medium">How can I help?</h4>
                        <p className="muted mt-1 text-xs">
                          Ask about attendance, leaves or your team.
                        </p>
                        <div className="mt-5 flex w-full flex-col gap-2">
                          {prompts.map((p) => (
                            <button
                              key={p}
                              onClick={() => send(p)}
                              className="rounded-lg border px-3 py-2 text-left text-xs transition-colors cursor-pointer"
                              style={{
                                borderColor:
                                  'color-mix(in srgb, var(--primary) 25%, transparent)',
                                background: 'var(--primary-soft)',
                                color: 'var(--primary)',
                              }}
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {messages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`flex gap-2 ${
                              msg.role === 'user' ? 'justify-end' : 'justify-start'
                            }`}
                          >
                            {msg.role === 'ai' && (
                              <span
                                className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full"
                                style={{
                                  background: 'var(--primary)',
                                  color: 'var(--primary-fg)',
                                }}
                              >
                                <Sparkles size={11} />
                              </span>
                            )}
                            <div
                              className="max-w-[80%] rounded-xl px-3 py-2 text-sm"
                              style={
                                msg.role === 'user'
                                  ? {
                                      background: 'var(--primary)',
                                      color: 'var(--primary-fg)',
                                      borderTopRightRadius: 4,
                                    }
                                  : {
                                      background: 'var(--surface-2)',
                                      color: 'var(--text)',
                                      borderTopLeftRadius: 4,
                                    }
                              }
                            >
                              <RichText text={msg.content} />
                            </div>
                          </div>
                        ))}

                        {thinking && (
                          <div className="flex gap-2">
                            <span
                              className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full"
                              style={{
                                background: 'var(--primary)',
                                color: 'var(--primary-fg)',
                              }}
                            >
                              <Sparkles size={11} />
                            </span>
                            <div className="flex items-center gap-1 rounded-xl bg-[var(--surface-2)] px-3 py-3">
                              {[0, 0.2, 0.4].map((delay) => (
                                <motion.span
                                  key={delay}
                                  animate={{ y: [0, -4, 0] }}
                                  transition={{ repeat: Infinity, duration: 0.7, delay }}
                                  className="h-1.5 w-1.5 rounded-full"
                                  style={{ background: 'var(--text-subtle)' }}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                        <div ref={endRef} />
                      </div>
                    )}
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      send(input)
                    }}
                    className="flex items-center gap-2 border-t border-[var(--border)] p-3"
                  >
                    <input
                      ref={inputRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="Ask me anything…"
                      aria-label="Message"
                      className="field"
                    />
                    <button
                      type="submit"
                      disabled={!input.trim() || thinking}
                      aria-label="Send message"
                      className="btn btn-primary shrink-0 px-3"
                    >
                      {thinking ? <Spinner size={15} /> : <Send size={15} />}
                    </button>
                  </form>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  )
}

/**
 * Render `**bold**` without going through innerHTML.
 *
 * The previous version piped the model's reply into dangerouslySetInnerHTML,
 * so any markup the model echoed back — including a script-bearing tag from a
 * poisoned record in the database — would execute. Splitting on the delimiter
 * and emitting real elements keeps everything else as inert text.
 */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <span className="whitespace-pre-wrap">
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </span>
  )
}
