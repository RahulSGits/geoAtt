'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import type { Notification } from '@/components/DashboardShell'

interface NotificationRow {
  id: string
  title: string
  body: string | null
  kind: string | null
  seen: boolean
  created_at: string
}

/**
 * Live notification feed for the signed-in user.
 *
 * Loads the recent rows once, then subscribes to Postgres changes so a leave
 * approval or an attendance edit from HR appears without a refresh. Also
 * subscribes to new announcements, which are company-wide, and surfaces them as
 * notifications too.
 *
 * Everything degrades quietly: if the notifications table or Realtime is not yet
 * set up, the initial load returns nothing and the subscription simply never
 * fires — the bell just stays empty rather than erroring.
 */
export function useRealtimeNotifications(userId: string) {
  const [items, setItems] = useState<Notification[]>([])
  // Lazy initialiser: one client for the component's life, created without
  // touching a ref during render (which the React Compiler forbids).
  const [supabase] = useState(() => createClient())

  const toNotification = useCallback(
    (row: NotificationRow): Notification => ({
      id: row.id,
      title: row.title,
      body: row.body ?? '',
      createdAt: row.created_at,
      tone: (row.kind as Notification['tone']) ?? 'info',
      seen: row.seen,
    }),
    [],
  )

  useEffect(() => {
    if (!userId) return
    let active = true

    // Initial fetch.
    supabase
      .from('notifications')
      .select('id, title, body, kind, seen, created_at')
      // Filter explicitly rather than leaning on RLS alone: an HR or admin
      // policy that grants a wider read would otherwise put the whole company's
      // feed in this user's bell.
      .eq('recipient_id', userId)
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data }) => {
        if (active && data) setItems(data.map(toNotification))
      })

    // Live inserts/updates for this user's notifications.
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as NotificationRow
            setItems((prev) => [toNotification(row), ...prev].slice(0, 30))
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as NotificationRow
            setItems((prev) => prev.map((n) => (n.id === row.id ? toNotification(row) : n)))
          } else if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as { id?: string }).id
            setItems((prev) => prev.filter((n) => n.id !== oldId))
          }
        },
      )
      // New company announcements arrive for everyone; show them as a transient
      // notification so employees see a broadcast without reloading.
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'announcements' },
        (payload) => {
          const row = payload.new as { id: string; title: string; description: string; created_at: string }
          const announcement: Notification = {
            id: `ann-${row.id}`,
            title: `📣 ${row.title}`,
            body: row.description,
            createdAt: row.created_at,
            tone: 'info',
            seen: false,
          }
          setItems((prev) => [announcement, ...prev].slice(0, 30))
        },
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [userId, supabase, toNotification])

  /** Mark every unseen notification as read (announcement pseudo-rows are local only). */
  const markAllSeen = useCallback(async () => {
    const unseenIds = items.filter((n) => !n.seen && !n.id.startsWith('ann-')).map((n) => n.id)

    // Optimistic: flip locally first so the badge clears immediately.
    setItems((prev) => prev.map((n) => ({ ...n, seen: true })))

    if (unseenIds.length > 0) {
      await supabase
        .from('notifications')
        .update({ seen: true })
        .eq('recipient_id', userId)
        .in('id', unseenIds)
    }
  }, [items, supabase, userId])

  const unseenCount = items.filter((n) => !n.seen).length

  return { notifications: items, unseenCount, markAllSeen }
}
