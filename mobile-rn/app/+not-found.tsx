import { useMemo } from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'
import { useRouter } from 'expo-router'

import Screen from '../components/Screen'
import { useTheme } from '../lib/scheme'
import { radius, type Palette } from '../lib/theme'

/**
 * Catches a route that does not exist — most often a stale deep link from an
 * older build, or a push notification pointing at a screen since renamed.
 *
 * Sends people to the splash rather than to /home: index resolves the session
 * and the role and forwards accordingly, so an HR user is not dropped onto the
 * employee surface only to be bounced straight back out.
 */
export default function NotFound() {
  const router = useRouter()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  return (
    <Screen center>
      <Text style={styles.title}>Screen not found</Text>
      <Text style={styles.body}>
        That link points somewhere this version of the app does not have.
      </Text>
      <Pressable
        onPress={() => router.replace('/')}
        style={({ pressed }) => [styles.cta, pressed && { opacity: 0.9 }]}
        accessibilityRole="button"
      >
        <Text style={styles.ctaText}>GO TO GEOATT</Text>
      </Pressable>
    </Screen>
  )
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    title: { color: colors.ink, fontSize: 20, fontWeight: '700' },
    body: {
      marginTop: 8,
      marginHorizontal: 32,
      color: colors.inkMuted,
      fontSize: 14,
      lineHeight: 20,
      textAlign: 'center',
    },
    cta: {
      marginTop: 22,
      paddingHorizontal: 24,
      height: 46,
      borderRadius: radius.pill,
      backgroundColor: colors.brand,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ctaText: { color: colors.onBrand, fontSize: 13.5, fontWeight: '700', letterSpacing: 1 },
  })
