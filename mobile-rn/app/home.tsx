import { useCallback, useEffect, useState } from 'react'
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
import * as Location from 'expo-location'
import Animated, { FadeInUp } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import GeoAttLogo from '../components/GeoAttLogo'
import Screen from '../components/Screen'
import TabBar from '../components/TabBar'
import { useAuth } from '../lib/auth'
import { roleSatisfies } from '../lib/roles'
import {
  checkIn,
  checkOut,
  distanceMetres,
  enforcesGeofence,
  formatDuration,
  formatTime,
  getHistory,
  getMyEmployee,
  getShift,
  getSite,
  getToday,
  type Attendance,
  type Coords,
  type Employee,
  type Shift,
  type Site,
} from '../lib/data'
import { colors, radius, shadow } from '../lib/theme'

type State = {
  employee: Employee | null
  site: Site | null
  shift: Shift | null
  today: Attendance | null
  history: Attendance[]
}

const EMPTY: State = { employee: null, site: null, shift: null, today: null, history: [] }

export default function HomeRoute() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, role, ready, logOut } = useAuth()

  const [state, setState] = useState<State>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!ready) return
    if (!user) router.replace('/login')
    // HR and admin have no employees row by design, so there is nothing here
    // for them — send them to the console signpost instead of an empty state.
    else if (role && roleSatisfies(role, 'hr')) router.replace('/console')
  }, [ready, user, role, router])

  const load = useCallback(async () => {
    setError(null)
    try {
      const employee = await getMyEmployee()
      if (!employee) {
        setState(EMPTY)
        return
      }
      // In parallel — four sequential round trips is very visible on a phone
      // network.
      const [site, shift, today, history] = await Promise.all([
        getSite(employee.site_id),
        getShift(employee.shift_id),
        getToday(employee.id),
        getHistory(employee.id),
      ])
      setState({ employee, site, shift, today, history })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your attendance.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (ready && user) void load()
  }, [ready, user, load])

  /**
   * Read the device position.
   *
   * Returns null when permission is refused rather than throwing: a remote or
   * hybrid site records the location without enforcing it, so a refusal must
   * not block the check-in. `enforcesGeofence` decides whether null is
   * actually acceptable.
   */
  async function readLocation(): Promise<Coords | null> {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return null
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      })
      return {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? null,
      }
    } catch {
      return null
    }
  }

  async function onCheckIn() {
    if (!state.employee) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const coords = await readLocation()

      // The fence is re-checked server-side as well. This is the friendly
      // early failure, not the control.
      if (enforcesGeofence(state.site)) {
        if (!coords) {
          setError('Location is required to check in at this site. Enable location access.')
          return
        }
        const away = distanceMetres(coords, {
          latitude: state.site!.latitude!,
          longitude: state.site!.longitude!,
        })
        if (away > state.site!.radius_m) {
          setError(
            `You are ${Math.round(away)} m from ${state.site!.name}, outside its ${state.site!.radius_m} m zone.`,
          )
          return
        }
      }

      await checkIn(state.employee.id, state.site?.id ?? null, coords)
      setNotice('Checked in.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check-in failed.')
    } finally {
      setBusy(false)
    }
  }

  async function onCheckOut() {
    if (!state.today) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await checkOut(state.today.id, await readLocation())
      setNotice('Checked out.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check-out failed.')
    } finally {
      setBusy(false)
    }
  }

  const { employee, site, shift, today, history } = state
  const isIn = !!today?.check_in && !today?.check_out
  const isDone = !!today?.check_in && !!today?.check_out

  const greeting = employee?.full_name?.split(' ')[0] ?? user?.email?.split('@')[0] ?? 'there'

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
        <Animated.View entering={FadeInUp.duration(420)} style={styles.header}>
          <GeoAttLogo size={46} static />
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text style={styles.hello}>Hi, {greeting}</Text>
            <Text style={styles.sub}>
              {employee?.employee_id ? `${employee.employee_id} · ` : ''}
              {employee?.designation ?? user?.email ?? ''}
            </Text>
          </View>
        </Animated.View>

        {loading && !employee ? (
          <View style={styles.card}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : !employee ? (
          <Animated.View entering={FadeInUp.duration(420).delay(80)} style={styles.card}>
            <Text style={styles.cardTitle}>No employee record</Text>
            <Text style={styles.cardBody}>
              This account can sign in, but it is not on the roster — so there is nothing to
              check in against. Admin and HR accounts work this way by design. Ask HR to add
              you as an employee.
            </Text>
            {error && <Text style={styles.error}>{error}</Text>}
          </Animated.View>
        ) : (
          <>
            <Animated.View entering={FadeInUp.duration(420).delay(80)} style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>Today</Text>
                <StatusPill status={today?.status ?? 'not started'} late={today?.is_late} />
              </View>

              <View style={styles.times}>
                <Time label="Check in" value={formatTime(today?.check_in ?? null)} />
                <Time label="Check out" value={formatTime(today?.check_out ?? null)} />
                <Time label="Worked" value={formatDuration(today?.work_minutes ?? 0)} />
              </View>

              {shift && (
                <Text style={styles.meta}>
                  {shift.name} · {shift.start_time.slice(0, 5)}–{shift.end_time.slice(0, 5)}
                  {site ? ` · ${site.name}` : ''}
                </Text>
              )}

              {error && <Text style={styles.error}>{error}</Text>}
              {notice && <Text style={styles.notice}>{notice}</Text>}

              {isDone ? (
                <View style={[styles.cta, styles.ctaDone]}>
                  <Text style={styles.ctaDoneText}>Day complete</Text>
                </View>
              ) : (
                <Pressable
                  onPress={isIn ? onCheckOut : onCheckIn}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.cta,
                    isIn && styles.ctaOut,
                    busy && styles.ctaDisabled,
                    pressed && { opacity: 0.9 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={isIn ? 'Check out' : 'Check in'}
                  accessibilityState={{ disabled: busy, busy }}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.onBrand} />
                  ) : (
                    <Text style={styles.ctaText}>{isIn ? 'CHECK OUT' : 'CHECK IN'}</Text>
                  )}
                </Pressable>
              )}
            </Animated.View>

            <Animated.View entering={FadeInUp.duration(420).delay(160)} style={styles.card}>
              <Text style={styles.cardTitle}>Last 14 days</Text>
              {history.length === 0 ? (
                <Text style={styles.cardBody}>No attendance recorded yet.</Text>
              ) : (
                history.map((row) => (
                  <View key={row.id} style={styles.historyRow}>
                    <Text style={styles.historyDate}>
                      {new Date(row.date).toLocaleDateString([], {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })}
                    </Text>
                    <Text style={styles.historyTimes}>
                      {formatTime(row.check_in)} – {formatTime(row.check_out)}
                    </Text>
                    <Text style={styles.historyHours}>{formatDuration(row.work_minutes)}</Text>
                    <StatusPill status={row.status} late={row.is_late} compact />
                  </View>
                ))
              )}
            </Animated.View>
          </>
        )}

        <Pressable
          onPress={async () => {
            await logOut()
            router.replace('/login')
          }}
          style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
      <TabBar />
    </Screen>
  )
}

function Time({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.timeLabel}>{label}</Text>
      <Text style={styles.timeValue}>{value}</Text>
    </View>
  )
}

/** Colour follows meaning: present green, half orange, late amber, absent red. */
function StatusPill({
  status,
  late,
  compact,
}: {
  status: string
  late?: boolean
  compact?: boolean
}) {
  const label = late && status === 'present' ? 'late' : status
  const tone =
    label === 'present'
      ? colors.success
      : label === 'half'
        ? colors.warning
        : label === 'late'
          ? colors.warning
          : label === 'absent'
            ? colors.danger
            : colors.inkMuted

  return (
    <View style={[styles.pill, compact && styles.pillCompact, { backgroundColor: `${tone}1A` }]}>
      <Text style={[styles.pillText, compact && { fontSize: 10 }, { color: tone }]}>
        {label.toUpperCase()}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20 },

  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  hello: { color: colors.ink, fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  sub: { color: colors.inkMuted, fontSize: 12.5, marginTop: 2 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 20,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.hairline,
    boxShadow: shadow.md,
  },
  cardTitle: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  cardBody: { marginTop: 8, color: colors.inkMuted, fontSize: 13.5, lineHeight: 20 },

  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  times: { flexDirection: 'row', marginTop: 16, marginBottom: 4 },
  timeLabel: { color: colors.inkFaint, fontSize: 11, fontWeight: '600', letterSpacing: 0.4 },
  timeValue: { color: colors.ink, fontSize: 17, fontWeight: '700', marginTop: 3 },

  meta: { marginTop: 10, color: colors.inkMuted, fontSize: 12 },

  error: { marginTop: 12, color: colors.danger, fontSize: 13, lineHeight: 18 },
  notice: { marginTop: 12, color: colors.success, fontSize: 13, lineHeight: 18 },

  cta: {
    marginTop: 16,
    height: 50,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaOut: { backgroundColor: colors.success },
  ctaDisabled: { backgroundColor: colors.inkFaint },
  ctaDone: { backgroundColor: colors.surfaceSunken },
  ctaText: { color: colors.onBrand, fontSize: 14.5, fontWeight: '700', letterSpacing: 1.1 },
  ctaDoneText: { color: colors.inkMuted, fontSize: 14, fontWeight: '600' },

  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    gap: 8,
  },
  historyDate: { color: colors.ink, fontSize: 13, fontWeight: '600', width: 84 },
  historyTimes: { color: colors.inkMuted, fontSize: 12, flex: 1 },
  historyHours: { color: colors.ink, fontSize: 12, fontWeight: '600' },

  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  pillCompact: { paddingHorizontal: 7, paddingVertical: 2 },
  pillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },

  signOut: {
    marginTop: 6,
    height: 48,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutText: { color: colors.inkMuted, fontSize: 14, fontWeight: '600', letterSpacing: 0.6 },
})
