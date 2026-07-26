'use client'

import { motion } from 'motion/react'
import { useState } from 'react'
import { Megaphone, Plus, Trash2 } from 'lucide-react'
import Modal from '@/components/Modal'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import { Alert, EmptyState, PageHeader, Panel, PriorityBadge, SearchInput, Spinner, staggerContainer, staggerItem } from '@/components/ui'
import { formatDateTime } from '@/lib/format'
import type { Announcement } from '@/lib/types'
import { createAnnouncement, deleteAnnouncement } from '../actions'

export default function AnnouncementsSection({
  announcements,
}: {
  announcements: Announcement[]
}) {
  const [query, setQuery] = useState('')
  const [composing, setComposing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Announcement | null>(null)
  const [deleting, setDeleting] = useState(false)

  const needle = query.trim().toLowerCase()
  const shown = needle
    ? announcements.filter((a) =>
        `${a.title} ${a.description ?? ''}`.toLowerCase().includes(needle),
      )
    : announcements
  const toast = useToast()
  const router = useRouter()

  async function handleDelete() {
    if (!confirmDelete) return
    setDeleting(true)

    const fd = new FormData()
    fd.set('id', confirmDelete.id)
    const res = await deleteAnnouncement(fd)

    if (res.ok) {
      toast.success('Announcement deleted.')
      setConfirmDelete(null)
      router.refresh()
    } else {
      toast.error(res.error)
      setDeleting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Announcements"
        subtitle={`${announcements.length} posted`}
        action={
          <button onClick={() => setComposing(true)} className="btn btn-primary btn-sm">
            <Plus size={15} /> New announcement
          </button>
        }
      />

      {announcements.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search announcements"
            label="Search announcements"
          />
          {query && (
            <span className="muted text-xs">
              {shown.length} of {announcements.length}
            </span>
          )}
        </div>
      )}

      {announcements.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Megaphone size={30} />}
            title="No announcements yet"
            description="Broadcast a message and every employee will see it on their dashboard."
            action={
              <button onClick={() => setComposing(true)} className="btn btn-primary btn-sm">
                <Plus size={15} /> New announcement
              </button>
            }
          />
        </Panel>
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
        >
          {shown.map((a) => (
            <motion.article key={a.id} variants={staggerItem} className="card lift p-4">
              <div className="mb-1.5 flex items-start gap-2">
                <h3 className="min-w-0 flex-1 font-medium">{a.title}</h3>
                <PriorityBadge priority={a.priority} />
              </div>
              <p className="muted whitespace-pre-line text-sm">{a.description}</p>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-2.5">
                <span className="muted text-xs">{formatDateTime(a.created_at)}</span>
                <button
                  onClick={() => setConfirmDelete(a)}
                  aria-label={`Delete announcement: ${a.title}`}
                  className="icon-btn icon-btn-danger"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </motion.article>
          ))}
        </motion.div>
      )}

      <Modal
        open={composing}
        onClose={() => setComposing(false)}
        title="New announcement"
        description="Visible to every employee immediately."
      >
        <ComposeForm onDone={() => setComposing(false)} />
      </Modal>

      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Delete announcement?"
        description={confirmDelete?.title}
        size="sm"
      >
        <div className="space-y-3">
          <Alert tone="warning">This cannot be undone.</Alert>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDelete(null)} className="btn btn-ghost">
              Cancel
            </button>
            <button onClick={handleDelete} disabled={deleting} className="btn btn-danger">
              {deleting && <Spinner size={16} />} Delete
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}

function ComposeForm({ onDone }: { onDone: () => void }) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const res = await createAnnouncement(new FormData(e.currentTarget))
    if (res.ok) {
      toast.success('Announcement published.')
      onDone()
      router.refresh()
    } else {
      setError(res.error)
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="label" htmlFor="ann-title">
          Title
        </label>
        <input
          id="ann-title"
          name="title"
          required
          maxLength={120}
          placeholder="Office closed on Friday"
          className="field"
        />
      </div>

      <div>
        <label className="label" htmlFor="ann-body">
          Message
        </label>
        <textarea
          id="ann-body"
          name="description"
          required
          rows={5}
          placeholder="Give people the detail they need to act on this."
          className="field resize-y"
        />
      </div>

      <div>
        <label className="label" htmlFor="ann-priority">
          Priority
        </label>
        <select id="ann-priority" name="priority" defaultValue="normal" className="field">
          <option value="low">Low — FYI</option>
          <option value="normal">Normal</option>
          <option value="high">Important</option>
        </select>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onDone} className="btn btn-ghost">
          Cancel
        </button>
        <button type="submit" disabled={submitting} className="btn btn-primary">
          {submitting && <Spinner size={16} />} Publish
        </button>
      </div>
    </form>
  )
}
