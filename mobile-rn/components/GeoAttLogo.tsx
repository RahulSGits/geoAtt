import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg'

import { colors, splashTiming } from '../lib/theme'

const AnimatedCircle = Animated.createAnimatedComponent(Circle)
const AnimatedPath = Animated.createAnimatedComponent(Path)

/**
 * Geometry is expressed in a 100×100 viewBox so the whole mark scales from one
 * `size` prop without a single hard-coded pixel.
 */
const VIEW = 100
const RING_R = 44
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R

// The check, drawn as one stroked path so it can be revealed by dash offset.
const MARK_PATH = 'M32 51.5 L44.5 64 L69 36'
// Measured along the path: two segments, 12.5√2 and 24.5√2 in viewBox units.
const MARK_LENGTH = Math.hypot(12.5, 12.5) + Math.hypot(24.5, 28)

type Props = {
  size?: number
  /** Skip the entrance and render the finished state — used by static previews. */
  static?: boolean
}

/**
 * The geoAtt mark: a gradient plate, a ring that draws itself, and a check that
 * strokes in behind it.
 *
 * The ring and the check are revealed with `strokeDashoffset` rather than
 * opacity, which is what makes it read as *drawn* instead of merely faded in —
 * and both run as animated SVG props on the UI thread, so the sequence holds
 * 60fps even while Metro is still resolving the rest of the bundle.
 */
export default function GeoAttLogo({ size = 132, static: isStatic = false }: Props) {
  const plateScale = useSharedValue(isStatic ? 1 : 0.62)
  const plateOpacity = useSharedValue(isStatic ? 1 : 0)
  const ringProgress = useSharedValue(isStatic ? 1 : 0)
  const markProgress = useSharedValue(isStatic ? 1 : 0)
  const glow = useSharedValue(isStatic ? 0.5 : 0)

  useEffect(() => {
    if (isStatic) return

    plateOpacity.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.quad) })

    // Slightly under-damped so the plate settles with one soft overshoot.
    plateScale.value = withSpring(1, { damping: 11, stiffness: 130, mass: 0.9 })

    ringProgress.value = withDelay(
      splashTiming.ringDraw,
      withTiming(1, { duration: 720, easing: Easing.inOut(Easing.cubic) }),
    )

    markProgress.value = withDelay(
      splashTiming.markDraw,
      withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) }),
    )

    // A slow two-beat breath under the plate; stops mattering once we exit.
    glow.value = withDelay(
      splashTiming.pulse,
      withRepeat(
        withSequence(
          withTiming(0.85, { duration: 900, easing: Easing.inOut(Easing.sin) }),
          withTiming(0.4, { duration: 900, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
      ),
    )
  }, [isStatic, glow, markProgress, plateOpacity, plateScale, ringProgress])

  const plateStyle = useAnimatedStyle(() => ({
    opacity: plateOpacity.value,
    transform: [{ scale: plateScale.value }],
  }))

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value * 0.55,
    transform: [{ scale: 1 + glow.value * 0.13 }],
  }))

  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: RING_CIRCUMFERENCE * (1 - ringProgress.value),
  }))

  const markProps = useAnimatedProps(() => ({
    strokeDashoffset: MARK_LENGTH * (1 - markProgress.value),
  }))

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: size / 2,
            backgroundColor: colors.brandLight,
            // A cheap bloom: a blurred shadow reads better than an SVG filter,
            // which react-native-svg does not support consistently on Android.
            //
            // `boxShadow` rather than the shadow* props, and `pointerEvents` in
            // style rather than as a prop — both of the old forms are deprecated
            // in React Native 0.86 and warn on every render.
            boxShadow: `0px 0px ${size * 0.42}px ${colors.brandLight}`,
            pointerEvents: 'none',
          },
          glowStyle,
        ]}
      />

      <Animated.View style={plateStyle}>
        <Svg width={size} height={size} viewBox={`0 0 ${VIEW} ${VIEW}`}>
          <Defs>
            <LinearGradient id="plate" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={colors.brandLight} />
              <Stop offset="1" stopColor={colors.brandDark} />
            </LinearGradient>
          </Defs>

          <Circle cx={VIEW / 2} cy={VIEW / 2} r={VIEW / 2} fill="url(#plate)" />

          <AnimatedCircle
            cx={VIEW / 2}
            cy={VIEW / 2}
            r={RING_R}
            stroke={colors.onBrand}
            strokeOpacity={0.9}
            strokeWidth={3}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            // Start the stroke at 12 o'clock instead of 3 o'clock.
            transform={`rotate(-90 ${VIEW / 2} ${VIEW / 2})`}
            animatedProps={ringProps}
          />

          <AnimatedPath
            d={MARK_PATH}
            stroke={colors.onBrand}
            strokeWidth={9}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            strokeDasharray={MARK_LENGTH}
            animatedProps={markProps}
          />
        </Svg>
      </Animated.View>
    </View>
  )
}
