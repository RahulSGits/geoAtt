import { useCallback, useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'

import FinAttLogo from '../components/FinAttLogo'
import { useAuth } from '../lib/auth'
import { colors, splashTiming } from '../lib/theme'

/**
 * The animated splash — the first thing anyone sees.
 *
 * It takes over from the native splash (same backdrop, same mark, so the swap
 * is invisible), plays the entrance, then hands off to `/login` or `/home`.
 *
 * Navigation is driven from the animation's own completion callback rather than
 * a `setTimeout`, so the route change can never land mid-stroke on a slow
 * device — the timeline is the single source of truth.
 */
export default function SplashRoute() {
  const router = useRouter()
  const { user, ready } = useAuth()

  const screenOpacity = useSharedValue(1)
  const contentShift = useSharedValue(0)

  const wordmarkOpacity = useSharedValue(0)
  const wordmarkShift = useSharedValue(18)
  const taglineOpacity = useSharedValue(0)
  const dotsOpacity = useSharedValue(0)

  // Hide the native splash only once our own first frame is up.
  const onLayout = useCallback(() => {
    SplashScreen.hideAsync().catch(() => {})
  }, [])

  const leave = useCallback(() => {
    // `ready` gates on Firebase replaying persisted auth. If it has not settled
    // by the time the animation ends we still leave — /login redirects itself
    // once state arrives, which beats holding the user on a frozen splash.
    router.replace(user ? '/home' : '/login')
  }, [router, user])

  useEffect(() => {
    wordmarkOpacity.value = withDelay(
      splashTiming.wordmarkIn,
      withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) }),
    )
    wordmarkShift.value = withDelay(
      splashTiming.wordmarkIn,
      withTiming(0, { duration: 620, easing: Easing.out(Easing.cubic) }),
    )
    taglineOpacity.value = withDelay(
      splashTiming.taglineIn,
      withTiming(1, { duration: 560, easing: Easing.out(Easing.quad) }),
    )
    dotsOpacity.value = withDelay(
      splashTiming.taglineIn + 220,
      withRepeat(
        withSequence(
          withTiming(0.85, { duration: 620, easing: Easing.inOut(Easing.sin) }),
          withTiming(0.25, { duration: 620, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
      ),
    )

    // Exit: lift the stack slightly while fading, so it reads as moving forward
    // into the app rather than simply switching off.
    contentShift.value = withDelay(
      splashTiming.exit,
      withTiming(-26, { duration: splashTiming.exitDuration, easing: Easing.in(Easing.cubic) }),
    )
    screenOpacity.value = withDelay(
      splashTiming.exit,
      withTiming(
        0,
        { duration: splashTiming.exitDuration, easing: Easing.in(Easing.quad) },
        (finished) => {
          if (finished) runOnJS(leave)()
        },
      ),
    )
  }, [
    contentShift,
    dotsOpacity,
    leave,
    screenOpacity,
    taglineOpacity,
    wordmarkOpacity,
    wordmarkShift,
  ])

  const screenStyle = useAnimatedStyle(() => ({ opacity: screenOpacity.value }))
  const stackStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: contentShift.value }],
  }))
  const wordmarkStyle = useAnimatedStyle(() => ({
    opacity: wordmarkOpacity.value,
    transform: [{ translateY: wordmarkShift.value }],
  }))
  const taglineStyle = useAnimatedStyle(() => ({ opacity: taglineOpacity.value }))
  const dotsStyle = useAnimatedStyle(() => ({ opacity: dotsOpacity.value }))

  // Nothing here depends on `ready`, but touching it keeps the auth
  // subscription mounted through the splash so /home is warm on arrival.
  void ready

  return (
    <Animated.View style={[styles.root, screenStyle]} onLayout={onLayout}>
      <LinearGradient
        colors={colors.backdrop}
        locations={[0, 0.55, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/*
        The splash keeps its own gradient rather than using <Screen>: it fades
        the backdrop out as one unit with the mark on exit, which a shared
        always-opaque background would sit behind and spoil.
      */}
      <Animated.View style={[styles.stack, stackStyle]}>
        <FinAttLogo size={136} />

        <Animated.View style={wordmarkStyle}>
          <Text style={styles.wordmark}>FinAtt</Text>
        </Animated.View>

        <Animated.View style={taglineStyle}>
          <Text style={styles.tagline}>ATTENDANCE & WORKFORCE</Text>
        </Animated.View>
      </Animated.View>

      <Animated.View style={[styles.dots, dotsStyle]}>
        <View style={styles.dot} />
        <View style={styles.dot} />
        <View style={styles.dot} />
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backdrop[0],
  },
  stack: {
    alignItems: 'center',
  },
  wordmark: {
    marginTop: 30,
    color: colors.onBrand,
    fontSize: 40,
    fontWeight: '700',
    letterSpacing: -0.8,
  },
  tagline: {
    marginTop: 10,
    color: colors.onBrandMuted,
    fontSize: 11,
    fontWeight: '600',
    // Wide tracking is what separates a tagline from a subtitle at this size.
    letterSpacing: 3.4,
  },
  dots: {
    position: 'absolute',
    bottom: 64,
    flexDirection: 'row',
    gap: 7,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.onBrand,
  },
})
