import { useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import NetInfo from '@react-native-community/netinfo'
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated'

import { useTheme } from '../lib/scheme'
import { type Palette } from '../lib/theme'

/**
 * A bar shown while the device has no usable connection.
 *
 * Every screen in this app reads from Supabase on mount, so offline is not a
 * degraded mode — it is a blank one. Without this the user sees empty cards and
 * assumes their attendance is missing, which is a far worse conclusion than
 * "you are offline".
 *
 * It keys on `isInternetReachable`, not `isConnected`. Connected only means the
 * radio has an association: captive portals, a hotel wifi splash page, and a
 * gate with a bar of signal all report connected while nothing can actually
 * reach Supabase. Reachable is the question the user cares about.
 *
 * `isInternetReachable` is null until the first probe resolves; that is treated
 * as online, so the app does not flash a scary banner during a normal launch.
 */
export default function OfflineBanner() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    return NetInfo.addEventListener((state) => {
      setOffline(state.isInternetReachable === false)
    })
  }, [])

  if (!offline) return null

  return (
    <Animated.View
      entering={FadeInDown.duration(220)}
      exiting={FadeOutUp.duration(180)}
      style={styles.bar}
    >
      <View style={styles.dot} />
      <Text style={styles.text}>No connection — showing the last loaded data</Text>
    </Animated.View>
  )
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 9,
      backgroundColor: colors.warningSoft,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
    dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.warning },
    text: { color: colors.warning, fontSize: 12, fontWeight: '600', flexShrink: 1 },
  })
