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
import Animated, { FadeInUp } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import GeoAttLogo from '../components/GeoAttLogo'
import Screen from '../components/Screen'
import TabBar from '../components/TabBar'
import { useAuth } from '../lib/auth'
import { roleLabel, roleSatisfies } from '../lib/roles'
import { REWARD_GOAL, getMyEmployee, getShift, getSite, type Employee, type Shift, type Site } from '../lib/data'
import { useTheme, type SchemePreference } from '../lib/scheme'
import { radius, type Palette } from '../lib/theme'

export default function ProfileRoute() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, role, ready, logOut } = useAuth()
  const { colors, shadow, preference, setPreference } = useTheme()
  const styles = useMemo(() => makeStyles(colors, shadow), [colors, shadow])

  const [employee, setEmployee] = useState<Employee | null>(null)
  const [site, setSite] = useState<Site | null>(null)
  const [shift, setShift] = useState<Shift | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!ready) return
    if (!user) router.replace('/login')
    else if (role && roleSatisfies(role, 'hr')) router.replace('/console')
  }, [ready, user, role, router])

  const load = useCallback(async () => {
    try {
      const e = await getMyEmployee()
      setEmployee(e)
      if (e) {
        const [s, sh] = await Promise.all([getSite(e.site_id), getShift(e.shift_id)])
        setSite(s)
        setShift(sh)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (ready && user) void load()
  }, [ready, user, load])

  const points = employee?.reward_points ?? 0
  const pct = Math.min(100, Math.round((points / REWARD_GOAL) * 100))

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
        <Text style={styles.pageTitle}>Profile</Text>

        <Animated.View entering={FadeInUp.duration(420)} style={styles.card}>
          <View style={styles.identity}>
            <GeoAttLogo size={44} static />
            <View style={{ marginLeft: 14, flex: 1 }}>
              <Text style={styles.name}>{employee?.full_name ?? user?.email ?? ''}</Text>
              <Text style={styles.email}>{employee?.email ?? user?.email ?? ''}</Text>
              {role ? <Text style={styles.role}>{roleLabel[role]}</Text> : null}
            </View>
          </View>
        </Animated.View>

        {loading && !employee ? (
          <View style={styles.card}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : employee ? (
          <>
            <Animated.View entering={FadeInUp.duration(420).delay(80)} style={styles.card}>
              <Text style={styles.cardTitle}>Employment</Text>
              <Row label="Employee ID" value={employee.employee_id} />
              <Row label="Designation" value={employee.designation ?? '—'} />
              <Row label="Department" value={employee.department ?? '—'} />
              <Row label="Status" value={employee.status} />
              <Row label="Work site" value={site?.name ?? '—'} />
              <Row
                label="Shift"
                value={
                  shift
                    ? `${shift.name} · ${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)}`
                    : '—'
                }
              />
            </Animated.View>

            <Animated.View entering={FadeInUp.duration(420).delay(160)} style={styles.card}>
              <Text style={styles.cardTitle}>Reward points</Text>
              <Text style={styles.points}>{points.toLocaleString()}</Text>
              <Text style={styles.cardBody}>
                Earned for punctual, in-geofence check-ins. {REWARD_GOAL.toLocaleString()} unlocks
                a reward.
              </Text>
              {/* Width is a percentage so the bar tracks the card, not a
                  hardcoded pixel width that would break on a tablet. */}
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${pct}%` }]} />
              </View>
            </Animated.View>
          </>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>No employee record</Text>
            <Text style={styles.cardBody}>
              This account signs in but is not on the roster.
            </Text>
          </View>
        )}

        <Animated.View entering={FadeInUp.duration(420).delay(240)} style={styles.card}>
          <Text style={styles.cardTitle}>Appearance</Text>
          <Text style={styles.cardBody}>
            System follows your phone&apos;s setting, the way the web console follows your
            browser.
          </Text>
          <View style={styles.schemeRow}>
            {(['light', 'dark', 'system'] as SchemePreference[]).map((opt) => {
              const active = preference === opt
              return (
                <Pressable
                  key={opt}
                  onPress={() => setPreference(opt)}
                  style={[styles.schemeChip, active && styles.schemeChipActive]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${opt} theme`}
                >
                  <Text style={[styles.schemeText, active && styles.schemeTextActive]}>
                    {opt[0].toUpperCase() + opt.slice(1)}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </Animated.View>

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

function Row({ label, value }: { label: string; value: string }) {
  const { colors, shadow, preference, setPreference } = useTheme()
  const styles = useMemo(() => makeStyles(colors, shadow), [colors, shadow])
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
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
    marginBottom: 16,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 20,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.hairline,
    boxShadow: shadow.md,
  },
  cardTitle: { color: colors.ink, fontSize: 17, fontWeight: '700', marginBottom: 6 },
  cardBody: { marginTop: 8, color: colors.inkMuted, fontSize: 13, lineHeight: 19 },

  identity: { flexDirection: 'row', alignItems: 'center' },
  name: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  email: { color: colors.inkMuted, fontSize: 13, marginTop: 2 },
  role: { color: colors.brand, fontSize: 12, fontWeight: '600', marginTop: 4 },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    gap: 12,
  },
  rowLabel: { color: colors.inkMuted, fontSize: 13 },
  rowValue: { color: colors.ink, fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' },

  points: { color: colors.ink, fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  track: {
    marginTop: 12,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.brand },

  schemeRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  schemeChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
  },
  schemeChipActive: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  schemeText: { color: colors.inkMuted, fontSize: 13, fontWeight: '600' },
  schemeTextActive: { color: colors.brand },

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
