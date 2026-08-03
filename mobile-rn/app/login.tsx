import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import GeoAttLogo from '../components/GeoAttLogo'
import { EyeIcon, EyeOffIcon, LockIcon, MailIcon } from '../components/Icons'
import Screen from '../components/Screen'
import { authErrorMessage, useAuth } from '../lib/auth'
import { isSupabaseConfigured } from '../lib/supabase'
import { colors, radius, shadow } from '../lib/theme'

/**
 * Sign-in only, by design. geoAtt has no public registration on any platform:
 * accounts are provisioned by an administrator or HR, so this screen offers no
 * way to create one — not a hidden way, no way. The auth layer (lib/auth.tsx)
 * has no register function either, so a future edit cannot quietly wire a
 * sign-up form back in.
 */
export default function LoginRoute() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, ready, signIn, resetPassword } = useAuth()

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // A session restored from disk lands here first; bounce straight through.
  useEffect(() => {
    if (ready && user) router.replace('/home')
  }, [ready, user, router])

  async function submit() {
    setError(null)
    setNotice(null)

    if (!identifier.trim() || !password) {
      setError('Enter your email or employee ID, and your password.')
      return
    }

    setBusy(true)
    try {
      await signIn(identifier, password)
      router.replace('/home')
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function forgot() {
    // Reset links only work against an email address — an employee ID would
    // need resolving first, and doing that here would leak which IDs exist.
    if (!identifier.trim() || !identifier.includes('@')) {
      setError('Enter your email address first, then tap Forgot password.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      await resetPassword(identifier)
      // Deliberately unconditional: confirming whether an address is registered
      // would turn this into an account-enumeration oracle.
      setNotice('If that email has an account, a reset link is on its way.')
    } catch (err) {
      setError(authErrorMessage(err))
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
            { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 32 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeInDown.duration(520)} style={styles.header}>
            <GeoAttLogo size={62} static />
            <Text style={styles.brand}>geoAtt</Text>
            <Text style={styles.brandTag}>Attendance & Workforce</Text>
          </Animated.View>

          <Animated.View entering={FadeInUp.duration(560).delay(120)} style={styles.card}>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>
              Sign in to mark attendance and view your records.
            </Text>

            {!isSupabaseConfigured && (
              <View style={styles.warn}>
                <Text style={styles.warnText}>
                  Supabase isn&apos;t configured yet. Copy .env.example to .env and add the
                  project URL and publishable key — sign-in stays disabled until then.
                </Text>
              </View>
            )}

            <Field
              icon={<MailIcon />}
              placeholder="Email or employee ID"
              value={identifier}
              onChangeText={setIdentifier}
              autoCapitalize="none"
              autoComplete="username"
              autoCorrect={false}
              textContentType="username"
            />

            <Field
              icon={<LockIcon />}
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!reveal}
              autoCapitalize="none"
              textContentType="password"
              trailing={
                <Pressable
                  onPress={() => setReveal((v) => !v)}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel={reveal ? 'Hide password' : 'Show password'}
                >
                  {reveal ? <EyeOffIcon /> : <EyeIcon />}
                </Pressable>
              }
            />

            {error && <Text style={styles.error}>{error}</Text>}
            {notice && <Text style={styles.notice}>{notice}</Text>}

            <Pressable
              onPress={submit}
              disabled={busy || !isSupabaseConfigured}
              style={({ pressed }) => [
                styles.cta,
                (busy || !isSupabaseConfigured) && styles.ctaDisabled,
                pressed && styles.ctaPressed,
              ]}
              accessibilityRole="button"
              // Explicit, because while `busy` the only child is a spinner —
              // the button would otherwise go unnamed exactly when it matters.
              accessibilityLabel="Log in"
              accessibilityState={{ disabled: busy || !isSupabaseConfigured, busy }}
            >
              {busy ? (
                <ActivityIndicator color={colors.onBrand} />
              ) : (
                <Text style={styles.ctaText}>LOGIN</Text>
              )}
            </Pressable>

            <Pressable
              onPress={forgot}
              disabled={busy}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Forgot password"
            >
              <Text style={styles.link}>Forgot password?</Text>
            </Pressable>

            <View style={styles.footerRow}>
              <Text style={styles.footerText}>
                No account? Access is provisioned by your administrator or HR.
              </Text>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

/** One labelled input row — icon, field, optional trailing control. */
function Field({
  icon,
  trailing,
  ...input
}: React.ComponentProps<typeof TextInput> & {
  icon: React.ReactNode
  trailing?: React.ReactNode
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldIcon}>{icon}</View>
      <TextInput
        style={styles.input}
        placeholderTextColor={colors.inkFaint}
        selectionColor={colors.brand}
        {...input}
      />
      {trailing ? <View style={styles.fieldTrailing}>{trailing}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 22 },

  header: { alignItems: 'center', marginBottom: 26 },
  brand: {
    marginTop: 14,
    color: colors.ink,
    fontSize: 27,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  brandTag: { marginTop: 3, color: colors.inkMuted, fontSize: 12.5, fontWeight: '500' },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 24,
    // A hairline plus a soft shadow, matching the web's .card. On a light page
    // the border does the separating; the heavy drop shadow that worked over a
    // gradient just looks muddy here.
    borderWidth: 1,
    borderColor: colors.hairline,
    boxShadow: shadow.md,
  },
  title: { color: colors.ink, fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  subtitle: { marginTop: 6, marginBottom: 20, color: colors.inkMuted, fontSize: 13.5, lineHeight: 19 },

  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  fieldIcon: { marginRight: 9 },
  fieldTrailing: { marginLeft: 9 },
  input: {
    flex: 1,
    paddingVertical: Platform.OS === 'ios' ? 14 : 11,
    color: colors.ink,
    fontSize: 15,
  },

  error: { marginTop: 2, marginBottom: 10, color: colors.danger, fontSize: 13, lineHeight: 18 },
  notice: { marginTop: 2, marginBottom: 10, color: colors.brand, fontSize: 13, lineHeight: 18 },
  warn: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.field,
    padding: 12,
    marginBottom: 14,
  },
  warnText: { color: colors.danger, fontSize: 12.5, lineHeight: 18 },

  cta: {
    marginTop: 6,
    height: 50,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPressed: { opacity: 0.88, transform: [{ scale: 0.99 }] },
  ctaDisabled: { backgroundColor: colors.inkFaint },
  ctaText: { color: colors.onBrand, fontSize: 14.5, fontWeight: '700', letterSpacing: 1.1 },

  link: {
    marginTop: 16,
    textAlign: 'center',
    color: colors.inkMuted,
    fontSize: 13,
    fontWeight: '500',
  },

  footerRow: {
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  footerText: {
    textAlign: 'center',
    color: colors.inkFaint,
    fontSize: 12.5,
    lineHeight: 18,
  },
})
