import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import Animated, { FadeInUp } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import Screen from '../components/Screen'
import TabBar from '../components/TabBar'
import { useAuth } from '../lib/auth'
import { roleSatisfies } from '../lib/roles'
import {
  applyLeave,
  getLeaveTypes,
  getLeaves,
  getMyEmployee,
  leaveDays,
  localDateKey,
  withdrawLeave,
  type Leave,
  type LeaveType,
} from '../lib/data'
import { colors, radius, shadow } from '../lib/theme'

/** `YYYY-MM-DD`, the format both the input and the date column use. */
const DATE_HINT = 'YYYY-MM-DD'
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export default function LeaveRoute() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, role, ready } = useAuth()

  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [types, setTypes] = useState<LeaveType[]>([])
  const [leaves, setLeaves] = useState<Leave[]>([])
  const [loading, setLoading] = useState(true)

  const [type, setType] = useState('')
  const [start, setStart] = useState(localDateKey())
  const [end, setEnd] = useState(localDateKey())
  const [reason, setReason] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!ready) return
    if (!user) router.replace('/login')
    else if (role && roleSatisfies(role, 'hr')) router.replace('/console')
  }, [ready, user, role, router])

  const load = useCallback(async () => {
    setError(null)
    try {
      const employee = await getMyEmployee()
      if (!employee) {
        setEmployeeId(null)
        return
      }
      setEmployeeId(employee.id)
      const [t, l] = await Promise.all([getLeaveTypes(), getLeaves(employee.id)])
      setTypes(t)
      setLeaves(l)
      setType((current) => current || t[0]?.name || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your leave.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (ready && user) void load()
  }, [ready, user, load])

  async function submit() {
    setError(null)
    setNotice(null)

    if (!employeeId) return
    if (!type) return setError('Choose a leave type.')
    if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) {
      return setError(`Dates must be ${DATE_HINT}.`)
    }
    // String comparison is safe and exact for ISO dates — no Date parsing, no
    // timezone to get wrong.
    if (end < start) return setError('The end date cannot be before the start date.')

    setBusy(true)
    try {
      await applyLeave({ employeeId, leaveType: type, startDate: start, endDate: end, reason })
      setNotice('Request submitted. HR will review it.')
      setReason('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the request.')
    } finally {
      setBusy(false)
    }
  }

  async function withdraw(id: string) {
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      await withdrawLeave(id)
      setNotice('Request withdrawn.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not withdraw the request.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 28 },
          ]}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} />
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.pageTitle}>Leave</Text>

          {!employeeId && !loading ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>No employee record</Text>
              <Text style={styles.cardBody}>
                Leave is requested against an employee record, and this account has none.
              </Text>
            </View>
          ) : (
            <>
              <Animated.View entering={FadeInUp.duration(420)} style={styles.card}>
                <Text style={styles.cardTitle}>Request leave</Text>

                <Text style={styles.label}>Type</Text>
                <View style={styles.chips}>
                  {types.map((t) => {
                    const active = t.name === type
                    return (
                      <Pressable
                        key={t.id}
                        onPress={() => setType(t.name)}
                        style={[styles.chip, active && styles.chipActive]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>
                          {t.name}
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>

                <View style={styles.dates}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>From</Text>
                    <TextInput
                      style={styles.input}
                      value={start}
                      onChangeText={setStart}
                      placeholder={DATE_HINT}
                      placeholderTextColor={colors.inkFaint}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                  <View style={{ width: 12 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>To</Text>
                    <TextInput
                      style={styles.input}
                      value={end}
                      onChangeText={setEnd}
                      placeholder={DATE_HINT}
                      placeholderTextColor={colors.inkFaint}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                </View>

                {ISO_DATE.test(start) && ISO_DATE.test(end) && end >= start && (
                  <Text style={styles.meta}>
                    {leaveDays(start, end)} day{leaveDays(start, end) === 1 ? '' : 's'}
                  </Text>
                )}

                <Text style={styles.label}>Reason</Text>
                <TextInput
                  style={[styles.input, styles.textarea]}
                  value={reason}
                  onChangeText={setReason}
                  placeholder="Optional"
                  placeholderTextColor={colors.inkFaint}
                  multiline
                />

                {error && <Text style={styles.error}>{error}</Text>}
                {notice && <Text style={styles.notice}>{notice}</Text>}

                <Pressable
                  onPress={submit}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.cta,
                    busy && styles.ctaDisabled,
                    pressed && { opacity: 0.9 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Submit leave request"
                  accessibilityState={{ disabled: busy, busy }}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.onBrand} />
                  ) : (
                    <Text style={styles.ctaText}>SUBMIT REQUEST</Text>
                  )}
                </Pressable>
              </Animated.View>

              <Animated.View entering={FadeInUp.duration(420).delay(90)} style={styles.card}>
                <Text style={styles.cardTitle}>Your requests</Text>
                {leaves.length === 0 ? (
                  <Text style={styles.cardBody}>Nothing requested yet.</Text>
                ) : (
                  leaves.map((l) => (
                    <View key={l.id} style={styles.leaveRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.leaveType}>{l.leave_type}</Text>
                        <Text style={styles.leaveDates}>
                          {l.start_date} → {l.end_date} · {leaveDays(l.start_date, l.end_date)}d
                        </Text>
                        {l.reason ? <Text style={styles.leaveReason}>{l.reason}</Text> : null}
                        {l.decision_note ? (
                          <Text style={styles.leaveReason}>HR: {l.decision_note}</Text>
                        ) : null}
                      </View>

                      <View style={{ alignItems: 'flex-end' }}>
                        <LeaveBadge status={l.status} />
                        {/* Only pending requests can be withdrawn — once HR has
                            decided, the record is theirs. RLS enforces it too. */}
                        {l.status === 'pending' && (
                          <Pressable
                            onPress={() => withdraw(l.id)}
                            disabled={busy}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={`Withdraw ${l.leave_type} request`}
                          >
                            <Text style={styles.withdraw}>Withdraw</Text>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  ))
                )}
              </Animated.View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <TabBar />
    </Screen>
  )
}

function LeaveBadge({ status }: { status: Leave['status'] }) {
  const tone =
    status === 'approved'
      ? colors.success
      : status === 'rejected'
        ? colors.danger
        : colors.warning
  return (
    <View style={[styles.badge, { backgroundColor: `${tone}1A` }]}>
      <Text style={[styles.badgeText, { color: tone }]}>{status.toUpperCase()}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
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
  cardTitle: { color: colors.ink, fontSize: 17, fontWeight: '700', marginBottom: 4 },
  cardBody: { marginTop: 8, color: colors.inkMuted, fontSize: 13.5, lineHeight: 20 },

  label: {
    marginTop: 14,
    marginBottom: 6,
    color: colors.inkMuted,
    fontSize: 12,
    fontWeight: '600',
  },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  chipActive: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  chipText: { color: colors.inkMuted, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: colors.brand },

  dates: { flexDirection: 'row' },
  input: {
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 9,
    color: colors.ink,
    fontSize: 15,
  },
  textarea: { minHeight: 72, textAlignVertical: 'top' },

  meta: { marginTop: 8, color: colors.inkMuted, fontSize: 12.5 },
  error: { marginTop: 12, color: colors.danger, fontSize: 13, lineHeight: 18 },
  notice: { marginTop: 12, color: colors.success, fontSize: 13, lineHeight: 18 },

  cta: {
    marginTop: 16,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: { backgroundColor: colors.inkFaint },
  ctaText: { color: colors.onBrand, fontSize: 14, fontWeight: '700', letterSpacing: 1 },

  leaveRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    gap: 10,
  },
  leaveType: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  leaveDates: { color: colors.inkMuted, fontSize: 12.5, marginTop: 2 },
  leaveReason: { color: colors.inkFaint, fontSize: 12, marginTop: 3, lineHeight: 17 },
  withdraw: { color: colors.danger, fontSize: 12, fontWeight: '600', marginTop: 8 },

  badge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill },
  badgeText: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5 },
})
