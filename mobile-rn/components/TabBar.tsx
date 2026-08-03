import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { usePathname, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle, Path, Rect } from 'react-native-svg'

import { useTheme } from '../lib/scheme'
import { radius, type Palette } from '../lib/theme'

/**
 * Bottom navigation for the employee surface.
 *
 * Hand-rolled rather than expo-router's Tabs. The splash, sign-in and the HR
 * console are full-bleed screens with no tab bar, and a Tabs layout would
 * either wrap them too or force a nested group purely to exclude them. This
 * renders where it is wanted and nowhere else.
 *
 * Icons are inline SVG for the same reason as components/Icons.tsx — three
 * glyphs do not justify an icon package that has to be kept in step with the
 * Expo SDK.
 */
type Tab = { href: '/home' | '/leave' | '/profile'; label: string; icon: IconName }
type IconName = 'clock' | 'calendar' | 'person'

const TABS: Tab[] = [
  { href: '/home', label: 'Attendance', icon: 'clock' },
  { href: '/leave', label: 'Leave', icon: 'calendar' },
  { href: '/profile', label: 'Profile', icon: 'person' },
]

export default function TabBar() {
  const { colors, shadow } = useTheme()
  const styles = useMemo(() => makeStyles(colors, shadow), [colors, shadow])
  const router = useRouter()
  const pathname = usePathname()
  const insets = useSafeAreaInsets()

  return (
    <View
      style={[
        styles.bar,
        // Sit above the home indicator rather than under it. A little padding
        // even without an inset, so the row is not flush to the screen edge.
        { paddingBottom: Math.max(insets.bottom, 8) },
      ]}
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href
        const tint = active ? colors.brand : colors.inkFaint
        return (
          <Pressable
            key={tab.href}
            onPress={() => router.replace(tab.href)}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
          >
            <TabIcon name={tab.icon} color={tint} />
            <Text style={[styles.label, { color: tint }]}>{tab.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function TabIcon({ name, color }: { name: IconName; color: string }) {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none' }
  const stroke = { stroke: color, strokeWidth: 1.8, strokeLinecap: 'round' as const }

  if (name === 'clock') {
    return (
      <Svg {...common}>
        <Circle cx={12} cy={12} r={8.5} {...stroke} />
        <Path d="M12 7.5V12l3 1.8" {...stroke} strokeLinejoin="round" />
      </Svg>
    )
  }
  if (name === 'calendar') {
    return (
      <Svg {...common}>
        <Rect x={3.5} y={5} width={17} height={15} rx={2.5} {...stroke} />
        <Path d="M3.5 9.5h17M8 3.5V6M16 3.5V6" {...stroke} />
      </Svg>
    )
  }
  return (
    <Svg {...common}>
      <Circle cx={12} cy={8} r={3.6} {...stroke} />
      <Path d="M5 19.5a7 7 0 0 1 14 0" {...stroke} />
    </Svg>
  )
}

type Shadow = { sm: string; md: string; lg: string }

const makeStyles = (colors: Palette, shadow: Shadow) =>
  StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    backgroundColor: colors.surface,
    paddingTop: 8,
  },
  tab: { flex: 1, alignItems: 'center', gap: 3 },
  label: { fontSize: 11, fontWeight: '600' },
})
