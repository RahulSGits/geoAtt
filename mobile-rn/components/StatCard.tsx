import { useMemo, type ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { useTheme } from '../lib/scheme'
import { radius, type Palette } from '../lib/theme'

/**
 * A KPI tile, matching the web's StatCard: label, big number, tinted icon, and
 * a sub-line for the period.
 *
 * `tone` colours the icon chip only — never the number. On the web the value
 * is always --text, so a row of four tiles reads as one set of figures rather
 * than four competing colours, and the tone stays available to mean something
 * (green for present, red for absent) instead of being decoration.
 */
type Props = {
  label: string
  value: number
  /** Fixed decimals; 0 rounds. Matches the web's `decimals` prop. */
  decimals?: number
  suffix?: string
  sub?: string
  tone: string
  icon: ReactNode
}

export default function StatCard({
  label,
  value,
  decimals = 0,
  suffix = '',
  sub,
  tone,
  icon,
}: Props) {
  const { colors, shadow } = useTheme()
  const styles = useMemo(() => makeStyles(colors, shadow), [colors, shadow])

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        <View style={[styles.chip, { backgroundColor: `${tone}1F` }]}>{icon}</View>
      </View>

      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value.toFixed(decimals)}
        {suffix}
      </Text>

      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
  )
}

type Shadow = { sm: string; md: string; lg: string }

const makeStyles = (colors: Palette, shadow: Shadow) =>
  StyleSheet.create({
    card: {
      // Two per row with the gap the parent applies. A percentage rather than a
      // fixed width so it holds on a tablet and in landscape.
      flexBasis: '48%',
      flexGrow: 1,
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: colors.hairline,
      boxShadow: shadow.sm,
      padding: 14,
    },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    label: { color: colors.inkMuted, fontSize: 12, fontWeight: '600', flexShrink: 1 },
    chip: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    value: {
      marginTop: 10,
      color: colors.ink,
      fontSize: 24,
      fontWeight: '700',
      letterSpacing: -0.5,
    },
    sub: { marginTop: 2, color: colors.inkFaint, fontSize: 11 },
  })
