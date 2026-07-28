import { useEffect } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import Animated, { FadeInUp } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import FinAttLogo from '../components/FinAttLogo'
import Screen from '../components/Screen'
import { useAuth } from '../lib/auth'
import { colors, radius } from '../lib/theme'

/**
 * Landing screen after sign-in.
 *
 * Intentionally minimal — this is the seam where the attendance features go.
 * It exists now so the auth loop is complete and testable end to end: sign in,
 * land here, restart the app and still be here, sign out and be bounced back.
 */
export default function HomeRoute() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, ready, logOut } = useAuth()

  useEffect(() => {
    if (ready && !user) router.replace('/login')
  }, [ready, user, router])

  const greeting = user?.displayName?.split(' ')[0] ?? user?.email?.split('@')[0] ?? 'there'

  return (
    <Screen>
      <View style={[styles.body, { paddingTop: insets.top + 26, paddingBottom: insets.bottom + 26 }]}>
        <Animated.View entering={FadeInUp.duration(520)} style={styles.header}>
          <FinAttLogo size={54} static />
          <View style={{ marginLeft: 13 }}>
            <Text style={styles.hello}>Hi, {greeting}</Text>
            <Text style={styles.email}>{user?.email ?? ''}</Text>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInUp.duration(560).delay(110)} style={styles.card}>
          <Text style={styles.cardTitle}>You&apos;re signed in</Text>
          <Text style={styles.cardBody}>
            Authentication is wired up and your session persists across restarts. Attendance
            check-in, history and leave go here next.
          </Text>
        </Animated.View>

        <View style={{ flex: 1 }} />

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
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: 22 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 26 },
  hello: { color: colors.onBrand, fontSize: 21, fontWeight: '700', letterSpacing: -0.3 },
  email: { color: colors.onBrandMuted, fontSize: 13, marginTop: 2 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 22,
    // See login.tsx — boxShadow replaces the deprecated shadow*/elevation pair.
    boxShadow: '0px 12px 24px rgba(0,0,0,0.20)',
  },
  cardTitle: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  cardBody: { marginTop: 8, color: colors.inkMuted, fontSize: 13.5, lineHeight: 20 },

  signOut: {
    height: 50,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.onBrandFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutText: { color: colors.onBrand, fontSize: 14, fontWeight: '600', letterSpacing: 0.6 },
})
