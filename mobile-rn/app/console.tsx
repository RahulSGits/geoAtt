import { useEffect, useMemo } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import Animated, { FadeInUp } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import GeoAttLogo from '../components/GeoAttLogo'
import Screen from '../components/Screen'
import { useAuth } from '../lib/auth'
import { roleLabel, roleSatisfies } from '../lib/roles'
import { useTheme } from '../lib/scheme'
import { radius, type Palette } from '../lib/theme'

/** Where the web console lives. Overridable per build. */
const CONSOLE_URL = process.env.EXPO_PUBLIC_SITE_URL ?? 'https://geo-att.vercel.app'

/**
 * The HR and admin landing screen.
 *
 * This is deliberately a signpost rather than a console. The web HR and admin
 * surfaces are dense table-and-chart work — a roster with CSV import, an
 * attendance grid with inline editing, a leave queue, the site map editor,
 * diagnostics. Rebuilding that on a phone would produce something strictly
 * worse than the site these users already have open on a laptop, and shipping
 * a half-console invites people to trust it for decisions it cannot support.
 *
 * The phone's job is the part a laptop cannot do: a camera and a GPS fix at
 * the moment of check-in. That is the employee surface, and it is built.
 *
 * An admin sees this rather than "No employee record" — which was accurate but
 * read like a fault, because an admin having no employees row is exactly how
 * the permission model is meant to work.
 */
export default function ConsoleRoute() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, role, fullName, ready, logOut } = useAuth()
  const { colors, shadow } = useTheme()
  const styles = useMemo(() => makeStyles(colors, shadow), [colors, shadow])

  useEffect(() => {
    if (!ready) return
    if (!user) router.replace('/login')
    // An employee landing here — by deep link, say — belongs on /home.
    else if (role && !roleSatisfies(role, 'hr')) router.replace('/home')
  }, [ready, user, role, router])

  const name = fullName?.split(' ')[0] ?? user?.email?.split('@')[0] ?? 'there'

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 28 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInUp.duration(420)} style={styles.header}>
          <GeoAttLogo size={46} static />
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text style={styles.hello}>Hi, {name}</Text>
            <Text style={styles.sub}>{role ? roleLabel[role] : ''}</Text>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInUp.duration(420).delay(80)} style={styles.card}>
          <Text style={styles.cardTitle}>Manage on the web console</Text>
          <Text style={styles.cardBody}>
            The roster, attendance grid, leave approvals, work sites and diagnostics live on
            the web console, where there is room for them. This app is the employee surface —
            it exists for the camera and GPS a laptop does not have.
          </Text>

          <Pressable
            onPress={() => Linking.openURL(CONSOLE_URL)}
            style={({ pressed }) => [styles.cta, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
            accessibilityLabel="Open the web console"
          >
            <Text style={styles.ctaText}>OPEN WEB CONSOLE</Text>
          </Pressable>
        </Animated.View>

        <Animated.View entering={FadeInUp.duration(420).delay(160)} style={styles.card}>
          <Text style={styles.cardTitle}>Why there is no check-in here</Text>
          <Text style={styles.cardBody}>
            Check-in is employee-only by design, and an {role ? roleLabel[role].toLowerCase() : ''} account has no
            employee record. That is not a gap — it is what stops an administrator marking
            attendance on someone else&apos;s behalf. The database enforces the same rule.
          </Text>
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
    </Screen>
  )
}

type Shadow = { sm: string; md: string; lg: string }

const makeStyles = (colors: Palette, shadow: Shadow) =>
  StyleSheet.create({
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

  cta: {
    marginTop: 16,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { color: colors.onBrand, fontSize: 14, fontWeight: '700', letterSpacing: 1 },

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
