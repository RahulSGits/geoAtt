import type { ReactNode } from 'react'
import { StyleSheet, View, type ViewStyle } from 'react-native'

import { colors } from '../lib/theme'

/**
 * The page surface, and the reason the web build is usable.
 *
 * React Native lays out to the viewport, so on a desktop browser every screen
 * stretched edge to edge — a 1900px-wide password field with a login button to
 * match. `CONTENT_MAX` caps the column and centres it, so the same tree reads
 * correctly at 375px and at 2560px without a media query.
 *
 * The background is the web app's `--bg`, not a gradient. The two apps are one
 * product: an employee checking in on a phone and an HR manager opening the
 * console should be looking at the same surface. The splash is the single
 * exception and paints its own gradient — it stands in for the OS launch image,
 * and a white flash there is exactly what it exists to avoid.
 */
const CONTENT_MAX = 440

type Props = {
  children: ReactNode
  /** Centre the column vertically too — used by the auth screens. */
  center?: boolean
  style?: ViewStyle
}

export default function Screen({ children, center = false, style }: Props) {
  return (
    <View style={styles.root}>
      <View style={[styles.column, center && styles.centered, style]}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
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
