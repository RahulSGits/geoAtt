import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import Animated, { FadeInUp } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import Screen from '../components/Screen'
import TabBar from '../components/TabBar'
import { useAuth } from '../lib/auth'
import { roleSatisfies } from '../lib/roles'
import { useTheme } from '../lib/scheme'
import {
  getAnnouncements,
  getNotifications,
  markNotificationRead,
  timeAgo,
  type Announcement,
  type Notification,
} from '../lib/data'
import { radius, type Palette } from '../lib/theme'

type Pane = 'announcements' | 'notifications'

/**
 * Announcements and the notification bell, on one screen with a segmented
 * switch.
 *
 * The web has these in two places — a sidebar section and a header bell — which
 * suits a layout with a persistent sidebar and room in the chrome. A phone has
 * neither, and two of five tabs spent on "things HR sent you" would crowd out
 * attendance. One tab, two views: the same content, reachable in the same
 * number of taps.
 */
export default function UpdatesRoute() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, role, ready } = useAuth()
  const { colors, shadow } = useTheme()
  const styles = useMemo(() => makeStyles(colors, shadow), [colors, shadow])

  const [pane, setPane] = useState<Pane>('announcements')
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ready) return
    if (!user) router.replace('/login')
    else if (role && roleSatisfies(role, 'hr')) router.replace('/console')
  }, [ready, user, role, router])

  const load = useCallback(async () => {
    setError(null)
    try {
      const [a, n] = await Promise.all([getAnnouncements(), getNotifications()])
      setAnnouncements(a)
      setNotifications(n)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load updates.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (ready && user) void load()
  }, [ready, user, load])

  const unread = notifications.filter((n) => !n.read_at).length

  /** Optimistic: the row dims immediately, then the write goes out. */
  async function read(n: Notification) {
    if (n.read_at) return
    setNotifications((rows) =>
      rows.map((r) => (r.id === n.id ? { ...r, read_at: new Date().toISOString() } : r)),
    )
    try {
      await markNotificationRead(n.id)
    } catch {
      // Put it back rather than leaving the UI claiming something that did not
      // happen. The next refresh reconciles either way.
      setNotifications((rows) =>
        rows.map((r) => (r.id === n.id ? { ...r, read_at: null } : r)),
      )
    }
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 28 },
        ]}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} />
        }
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.pageTitle}>Updates</Text>

        <View style={styles.segment}>
          {(['announcements', 'notifications'] as Pane[]).map((v) => {
            const active = pane === v
            const label = v === 'announcements' ? 'Announcements' : 'Notifications'
            return (
              <Pressable
                key={v}
                onPress={() => setPane(v)}
                style={[styles.segmentItem, active && styles.segmentItemActive]}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                  {label}
                  {v === 'notifications' && unread > 0 ? ` (${unread})` : ''}
                </Text>
              </Pressable>
            )
          })}
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        {loading && !announcements.length && !notifications.length ? (
          <View style={styles.card}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : pane === 'announcements' ? (
          announcements.length === 0 ? (
            <Empty
              styles={styles}
              title="No announcements"
              body="Company-wide updates from HR will appear here."
            />
          ) : (
            announcements.map((a, i) => (
              <Animated.View
                key={a.id}
                entering={FadeInUp.duration(380).delay(Math.min(i, 6) * 50)}
                style={styles.card}
              >
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>{a.title}</Text>
                  <PriorityBadge priority={a.priority} styles={styles} colors={colors} />
                </View>
                <Text style={styles.body}>{a.description}</Text>
                <Text style={styles.meta}>{timeAgo(a.published_at)}</Text>
              </Animated.View>
            ))
          )
        ) : notifications.length === 0 ? (
          <Empty
            styles={styles}
            title="Nothing yet"
            body="Leave decisions and attendance updates land here."
          />
        ) : (
          notifications.map((n, i) => (
            <Animated.View
              key={n.id}
              entering={FadeInUp.duration(380).delay(Math.min(i, 6) * 50)}
            >
              <Pressable
                onPress={() => read(n)}
                style={[styles.card, !!n.read_at && styles.cardRead]}
                accessibilityRole="button"
                accessibilityLabel={
                  n.read_at ? `${n.title}, read` : `${n.title}, unread. Tap to mark read`
                }
              >
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>{n.title}</Text>
                  {!n.read_at && <View style={styles.dot} />}
                </View>
                {n.body ? <Text style={styles.body}>{n.body}</Text> : null}
                <Text style={styles.meta}>{timeAgo(n.created_at)}</Text>
              </Pressable>
            </Animated.View>
          ))
        )}
      </ScrollView>
      <TabBar />
    </Screen>
  )
}

function Empty({
  styles,
  title,
  body,
}: {
  styles: ReturnType<typeof makeStyles>
  title: string
  body: string
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  )
}

function PriorityBadge({
  priority,
  styles,
  colors,
}: {
  priority: Announcement['priority']
  styles: ReturnType<typeof makeStyles>
  colors: Palette
}) {
  // Only high is worth a colour. Tinting 'normal' would make every post look
  // urgent, which is the same as none of them being urgent.
  if (priority === 'normal') return null
  const tone = priority === 'high' ? colors.danger : colors.inkFaint
  return (
    <View style={[styles.badge, { backgroundColor: `${tone}1A` }]}>
      <Text style={[styles.badgeText, { color: tone }]}>{priority.toUpperCase()}</Text>
    </View>
  )
}

type Shadow = { sm: string; md: string; lg: string }

const makeStyles = (colors: Palette, shadow: Shadow) =>
  StyleSheet.create({
    scroll: { paddingHorizontal: 20 },
    pageTitle: {
      color: colors.ink,
      fontSize: 26,
      fontWeight: '700',
      letterSpacing: -0.5,
      marginBottom: 14,
    },

    segment: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceSunken,
      borderRadius: radius.pill,
      padding: 4,
      marginBottom: 14,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    segmentItem: { flex: 1, paddingVertical: 8, borderRadius: radius.pill, alignItems: 'center' },
    segmentItemActive: { backgroundColor: colors.surface, boxShadow: shadow.sm },
    segmentText: { color: colors.inkMuted, fontSize: 13, fontWeight: '600' },
    segmentTextActive: { color: colors.ink },

    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      padding: 18,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.hairline,
      boxShadow: shadow.sm,
    },
    // Read notifications recede rather than disappear — still there, no longer
    // asking for attention.
    cardRead: { opacity: 0.62 },

    rowBetween: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    cardTitle: { color: colors.ink, fontSize: 15.5, fontWeight: '700', flexShrink: 1 },
    body: { marginTop: 7, color: colors.inkMuted, fontSize: 13.5, lineHeight: 20 },
    meta: { marginTop: 9, color: colors.inkFaint, fontSize: 11.5 },

    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand },

    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
    badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },

    error: { marginBottom: 12, color: colors.danger, fontSize: 13, lineHeight: 18 },
  })
