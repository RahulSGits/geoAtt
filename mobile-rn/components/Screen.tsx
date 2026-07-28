import type { ReactNode } from 'react'
import { StyleSheet, View, type ViewStyle } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'

import { colors } from '../lib/theme'

/**
 * The shared backdrop, and the reason the web build is usable.
 *
 * React Native lays out to the viewport, so on a desktop browser every screen
 * stretched edge to edge — a 1900px-wide password field with a login button to
 * match. `CONTENT_MAX` caps the column at a phone-ish width and centres it, so
 * the same tree reads correctly at 375px and at 2560px without a media query.
 *
 * The gradient stays full-bleed behind that column; only the content is capped.
 */
const CONTENT_MAX = 440

type Props = {
  children: ReactNode
  /** Centre the column vertically too — used by the splash. */
  center?: boolean
  style?: ViewStyle
}

export default function Screen({ children, center = false, style }: Props) {
  return (
    <View style={styles.root}>
      <LinearGradient
        colors={colors.backdrop}
        locations={[0, 0.55, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.column, center && styles.centered, style]}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.backdrop[0] },
  column: {
    flex: 1,
    width: '100%',
    maxWidth: CONTENT_MAX,
    // `alignSelf` is what actually centres the column once maxWidth bites.
    alignSelf: 'center',
  },
  centered: { alignItems: 'center', justifyContent: 'center' },
})

export { CONTENT_MAX }
