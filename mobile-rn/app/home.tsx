import { useCallback, useEffect, useState, useMemo } from 'react'
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

import FaceCapture from '../components/FaceCapture'
import GeoAttLogo from '../components/GeoAttLogo'
import LiveClock from '../components/LiveClock'
import Screen from '../components/Screen'
import StatCard from '../components/StatCard'
import {
  BadgeCheckIcon,
  CalendarCheckIcon,
  TimerIcon,
  TrendIcon,
} from '../components/Icons'
import TabBar from '../components/TabBar'
import { useAuth } from '../lib/auth'
import { haptics } from '../lib/haptics'
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
  isFaceEnrolled,
  allowedWorkModes,
  requestRecheckin,
  uploadSelfie,
  monthStats,
  type Attendance,
  type Coords,
  type Employee,
  type Shift,
  type Site,
} from '../lib/data'
import { useTheme } from '../lib/scheme'
import { radius, type Palette } from '../lib/theme'

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
  const { user, role, ready } = useAuth()
  const { colors, shadow } = useTheme()
  const styles = useMemo(() => makeStyles(colors, shadow), [colors, shadow])

  const [state, setState] = useState<State>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [workMode, setWorkMode] = useState<'on_site' | 'remote'>('on_site')
  const [cameraOpen, setCameraOpen] = useState(false)

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

  /**
   * Step one: check the fence, then open the camera.
   *
   * The geofence is evaluated *before* the camera opens. Failing afterwards
   * would make someone pose for a photo only to be told they are in the wrong
   * place, and would leave an unused image in the bucket.
   */
  async function onCheckIn() {
    if (!state.employee) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const coords = await readLocation()

      if (workMode === 'on_site' && enforcesGeofence(state.site)) {
        if (!coords) {
          haptics.error()
          setError('Location is required to check in at this site. Enable location access.')
          return
        }
        const away = distanceMetres(coords, {
          latitude: state.site!.latitude!,
          longitude: state.site!.longitude!,
        })
        if (away > state.site!.radius_m) {
          haptics.error()
          setError(
            `You are ${Math.round(away)} m from ${state.site!.name}, outside its ${state.site!.radius_m} m zone.`,
          )
          return
        }
      }

      setCameraOpen(true)
    } catch (err) {
      haptics.error()
      setError(err instanceof Error ? err.message : 'Check-in failed.')
    } finally {
      setBusy(false)
    }
  }

  /** Step two: upload the photo, then write the row. */
  async function completeCheckIn(base64: string) {
    setCameraOpen(false)
    if (!state.employee || !user) return
    setBusy(true)
    setError(null)
    try {
      const coords = await readLocation()

      // A failed upload must not cost someone their attendance — the selfie is
      // evidence attached to the check-in, not the check-in itself.
      const { path, error: uploadError } = await uploadSelfie(user.id, base64)
      if (uploadError) console.warn('[check-in] selfie upload failed:', uploadError)

      await checkIn(state.employee.id, state.site?.id ?? null, coords, workMode, path)
      haptics.success()
      setNotice(path ? 'Checked in.' : 'Checked in — the photo could not be saved.')
      await load()
    } catch (err) {
      haptics.error()
      setError(err instanceof Error ? err.message : 'Check-in failed.')
    } finally {
      setBusy(false)
    }
  }

  async function onRequestRecheckin() {
    if (!state.today) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await requestRecheckin(state.today.id, '')
      haptics.success()
      setNotice('Re-check-in requested — waiting for HR approval.')
      await load()
    } catch (err) {
      haptics.error()
      setError(err instanceof Error ? err.message : 'Could not send the request.')
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
      haptics.success()
      setNotice('Checked out.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check-out failed.')
    } finally {
      setBusy(false)
    }
  }

  const { employee, site, shift, today, history } = state
  const stats = useMemo(() => monthStats(history), [history])
  const modes = useMemo(() => allowedWorkModes(site, shift), [site, shift])
  const enrolled = isFaceEnrolled(employee)

  // Keep the selection inside what the assignment permits: a remote-only site
  // must not leave 'on_site' selected from a previous render.
  useEffect(() => {
    if (!modes.includes(workMode)) setWorkMode(modes[0])
  }, [modes, workMode])
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
          <GeoAttLogo size={38} static />
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text style={styles.hello}>Hi, {greeting}</Text>
            <Text style={styles.sub}>
              {employee?.employee_id ? `${employee.employee_id} · ` : ''}
              {employee?.designation ?? user?.email ?? ''}
            </Text>
            <LiveClock style={styles.clock} />
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

              {/*
                Standing notice, not a toast. The web refuses a check-in whose
                face does not match the enrolled template; this app cannot make
                that check, so every record it writes is verified by location
                alone. Saying so on the card is the difference between a known
                limitation and a silent downgrade of the control the product is
                built on.
              */}
              {/*
                Two different warnings, and the distinction matters. Not
                enrolled is a blocker the web enforces by refusing check-in
                outright; enrolled-but-unverified-here is a weaker check the
                user should know about. Showing one message for both would
                flatten a hard stop into a caveat.
              */}
              {!enrolled ? (
                <View style={styles.banner}>
                  <Text style={styles.bannerText}>
                    Your face is not enrolled yet. Enrol once on the web portal — it becomes
                    the template every future check-in is matched against.
                  </Text>
                </View>
              ) : (
                <View style={styles.banner}>
                  <Text style={styles.bannerText}>
                    Verified by location only. Face verification runs on the web portal — HR
                    can see which check-ins were face-verified.
                  </Text>
                </View>
              )}

              {shift && (
                <Text style={styles.meta}>
                  {shift.name} · {shift.start_time.slice(0, 5)}–{shift.end_time.slice(0, 5)}
                  {site ? ` · ${site.name}` : ''}
                </Text>
              )}

              {error && <Text style={styles.error}>{error}</Text>}
              {notice && <Text style={styles.notice}>{notice}</Text>}

              {/*
                Work mode, offered only where the assignment permits both. The
                web derives this the same way: a remote site or rota has no
                on-site option to give, and picking on-site keeps the geofence
                in full.
              */}
              {!isDone && !isIn && modes.length > 1 && (
                <View style={styles.modeRow}>
                  {modes.map((m) => {
                    const active = workMode === m
                    return (
                      <Pressable
                        key={m}
                        onPress={() => {
                          haptics.select()
                          setWorkMode(m)
                        }}
                        style={[styles.modeChip, active && styles.modeChipActive]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                      >
                        <Text style={[styles.modeText, active && styles.modeTextActive]}>
                          {m === 'on_site' ? 'On-site' : 'Work from home'}
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>
              )}

              {isDone ? (
                // Checked out. The web offers a re-check-in request rather than
                // letting the employee clear check_out — the approval is HR's,
                // and RLS stops them writing 'approved' themselves.
                today?.recheckin_status === 'requested' ? (
                  <View style={[styles.cta, styles.ctaDone]}>
                    <Text style={styles.ctaDoneText}>Re-check-in requested</Text>
                  </View>
                ) : today?.recheckin_status === 'approved' ? (
                  <Pressable
                    onPress={onCheckIn}
                    disabled={busy}
                    style={({ pressed }) => [styles.cta, pressed && { opacity: 0.9 }]}
                    accessibilityRole="button"
                    accessibilityLabel="Check in again"
                  >
                    <Text style={styles.ctaText}>CHECK IN AGAIN</Text>
                  </Pressable>
                ) : (
                  <>
                    <View style={[styles.cta, styles.ctaDone]}>
                      <Text style={styles.ctaDoneText}>Day complete</Text>
                    </View>
                    <Pressable
                      onPress={onRequestRecheckin}
                      disabled={busy}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Request to check in again"
                    >
                      <Text style={styles.link}>Need to check in again?</Text>
                    </Pressable>
                  </>
                )
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

            <Animated.View
              entering={FadeInUp.duration(420).delay(140)}
              style={styles.statRow}
            >
              <StatCard
                label="Present"
                value={stats.present}
                sub="this month"
                tone={colors.success}
                icon={<BadgeCheckIcon color={colors.success} />}
              />
              <StatCard
                label="Hours logged"
                value={stats.hours}
                decimals={1}
                suffix="h"
                sub="this month"
                tone={colors.brand}
                icon={<TimerIcon color={colors.brand} />}
              />
              <StatCard
                label="Attendance"
                value={stats.rate}
                suffix="%"
                sub="this month"
                tone={colors.warning}
                icon={<TrendIcon color={colors.warning} />}
              />
              <StatCard
                label="Leaves taken"
                value={stats.onLeave}
                sub="this month"
                tone={colors.info}
                icon={<CalendarCheckIcon color={colors.info} />}
              />
            </Animated.View>

            <Animated.View entering={FadeInUp.duration(420).delay(200)} style={styles.card}>
              <Text style={styles.cardTitle}>Recent</Text>
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

      </ScrollView>
      <TabBar />

      <FaceCapture
        visible={cameraOpen}
        onCancel={() => setCameraOpen(false)}
        onCaptured={({ base64 }) => void completeCheckIn(base64)}
      />
    </Screen>
  )
}

function Time({ label, value }: { label: string; value: string }) {
  const { colors, shadow } = useTheme()
  const styles = useMemo(() => makeStyles(colors, shadow), [colors, shadow])
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
  const { colors, shadow } = useTheme()
  const styles = useMemo(() => makeStyles(colors, shadow), [colors, shadow])
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

type Shadow = { sm: string; md: string; lg: string }

const makeStyles = (colors: Palette, shadow: Shadow) =>
  StyleSheet.create({
  scroll: { paddingHorizontal: 20 },

  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  hello: { color: colors.ink, fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  sub: { color: colors.inkMuted, fontSize: 12.5, marginTop: 2 },
  clock: { color: colors.inkFaint, fontSize: 11.5, marginTop: 3 },

  // `gap` rather than margins so the two-per-row wrap has no trailing gutter.
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },

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

  modeRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  modeChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
  },
  modeChipActive: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  modeText: { color: colors.inkMuted, fontSize: 12.5, fontWeight: '600' },
  modeTextActive: { color: colors.brand },

  link: {
    marginTop: 12,
    textAlign: 'center',
    color: colors.inkMuted,
    fontSize: 12.5,
    fontWeight: '600',
  },

  banner: {
    marginTop: 14,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.field,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bannerText: { color: colors.warning, fontSize: 12, lineHeight: 17 },

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

})
