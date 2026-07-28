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
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import FinAttLogo from '../components/FinAttLogo'
import { EyeIcon, EyeOffIcon, LockIcon, MailIcon } from '../components/Icons'
import { authErrorMessage, useAuth } from '../lib/auth'
import { isFirebaseConfigured } from '../lib/firebase'
import { colors, radius } from '../lib/theme'

type Mode = 'signIn' | 'register'

export default function LoginRoute() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, ready, signIn, register, resetPassword } = useAuth()

  const [mode, setMode] = useState<Mode>('signIn')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
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

    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    if (mode === 'register' && !name.trim()) {
      setError('Enter your name.')
      return
    }

    setBusy(true)
    try {
      if (mode === 'signIn') await signIn(email, password)
      else await register(name, email, password)
      router.replace('/home')
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function forgot() {
    if (!email.trim()) {
      setError('Enter your email first, then tap Forgot password.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      await resetPassword(email)
      // Deliberately unconditional: confirming whether an address is registered
      // would turn this into an account-enumeration oracle.
      setNotice('If that email has an account, a reset link is on its way.')
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const isRegister = mode === 'register'

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={colors.backdrop}
        locations={[0, 0.55, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

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
            <FinAttLogo size={62} static />
            <Text style={styles.brand}>FinAtt</Text>
            <Text style={styles.brandTag}>Attendance & Workforce</Text>
          </Animated.View>

          <Animated.View entering={FadeInUp.duration(560).delay(120)} style={styles.card}>
            <Text style={styles.title}>{isRegister ? 'Create account' : 'Welcome back'}</Text>
            <Text style={styles.subtitle}>
              {isRegister
                ? 'Set up your FinAtt account to start marking attendance.'
                : 'Sign in to mark attendance and view your records.'}
            </Text>

            {!isFirebaseConfigured && (
              <View style={styles.warn}>
                <Text style={styles.warnText}>
                  Firebase isn&apos;t configured yet. Copy .env.example to .env and add your
                  project keys — sign-in stays disabled until then.
                </Text>
              </View>
            )}

            {isRegister && (
              <Field
                icon={<MailIcon />}
                placeholder="Full name"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                textContentType="name"
              />
            )}

            <Field
              icon={<MailIcon />}
              placeholder="Email address"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
            />

            <Field
              icon={<LockIcon />}
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!reveal}
              autoCapitalize="none"
              textContentType={isRegister ? 'newPassword' : 'password'}
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
              disabled={busy || !isFirebaseConfigured}
              style={({ pressed }) => [
                styles.cta,
                (busy || !isFirebaseConfigured) && styles.ctaDisabled,
                pressed && styles.ctaPressed,
              ]}
              accessibilityRole="button"
              // Explicit, because while `busy` the only child is a spinner —
              // the button would otherwise go unnamed exactly when it matters.
              accessibilityLabel={isRegister ? 'Create account' : 'Log in'}
              accessibilityState={{ disabled: busy || !isFirebaseConfigured, busy }}
            >
              {busy ? (
                <ActivityIndicator color={colors.onBrand} />
              ) : (
                <Text style={styles.ctaText}>{isRegister ? 'CREATE ACCOUNT' : 'LOGIN'}</Text>
              )}
            </Pressable>

            {!isRegister && (
              <Pressable
                onPress={forgot}
                disabled={busy}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Forgot password"
              >
                <Text style={styles.link}>Forgot password?</Text>
              </Pressable>
            )}

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>
                {isRegister ? 'Already have an account?' : 'New to FinAtt?'}
              </Text>
              <Pressable
                onPress={() => {
                  setMode(isRegister ? 'signIn' : 'register')
                  setError(null)
                  setNotice(null)
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={isRegister ? 'Switch to sign in' : 'Switch to create account'}
              >
                <Text style={styles.switchAction}>{isRegister ? 'Sign in' : 'Create one'}</Text>
              </Pressable>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
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
  root: { flex: 1, backgroundColor: colors.backdrop[0] },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 22 },

  header: { alignItems: 'center', marginBottom: 26 },
  brand: {
    marginTop: 14,
    color: colors.onBrand,
    fontSize: 27,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  brandTag: { marginTop: 3, color: colors.onBrandMuted, fontSize: 12.5, fontWeight: '500' },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 24,
    // Lifts the card off the gradient without a hard edge.
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 14 },
    elevation: 10,
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
    backgroundColor: colors.dangerSurface,
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

  switchRow: {
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
  },
  switchLabel: { color: colors.inkMuted, fontSize: 13 },
  switchAction: { color: colors.brand, fontSize: 13, fontWeight: '700' },
})
