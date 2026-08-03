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
  type SharedValue,
} from 'react-native-reanimated'
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg'

import { RIDGES, ridgeLength, ridgePath } from '../lib/logo-geometry'
import { colors, splashTiming } from '../lib/theme'

const AnimatedPath = Animated.createAnimatedComponent(Path)

const VIEW = 100

type Props = {
  size?: number
  /** Skip the entrance and render the finished state — used by static previews. */
  static?: boolean
}

/**
 * The geoAtt mark: a fingerprint on a gradient plate.
 *
 * The ridges are revealed with `strokeDashoffset` and staggered from the centre
 * outward, so the print draws itself the way a scanner reads one. Opacity would
 * only fade a finished shape in.
 *
 * Every ridge animates as an SVG prop on the UI thread, so the sequence holds
 * 60fps while Metro is still resolving the rest of the bundle.
 *
 * Geometry lives in lib/logo-geometry.ts and is shared with the PNG rasteriser.
 * If the two drift, the handoff from the native splash to this jumps visibly.
 */
export default function GeoAttLogo({ size = 132, static: isStatic = false }: Props) {
  const plateScale = useSharedValue(isStatic ? 1 : 0.62)
  const plateOpacity = useSharedValue(isStatic ? 1 : 0)
  // Static renders sit on the light page surface, where the bloom reads as a
  // blur artifact rather than a glow. Only the splash — which is not static,
  // and paints its own dark gradient — has a backdrop dark enough for it.
  const glow = useSharedValue(0)

  // One progress value per ridge so they can be staggered. A single shared
  // value drives all of them; each Ridge reads its own slice by index, which
  // keeps the hook count fixed regardless of how many ridges are defined.
  const draw = useSharedValue(isStatic ? RIDGES.length : 0)

  useEffect(() => {
    if (isStatic) return

    plateOpacity.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.quad) })
    // Slightly under-damped so the plate settles with one soft overshoot.
    plateScale.value = withSpring(1, { damping: 11, stiffness: 130, mass: 0.9 })

    // Sweeps 0 -> RIDGES.length. Ridge i is drawn while `draw` crosses i..i+1,
    // which is what produces the centre-outward stagger from one animation.
    draw.value = withDelay(
      splashTiming.ridgeDraw,
      withTiming(RIDGES.length, {
        duration: splashTiming.ridgeDuration,
        easing: Easing.out(Easing.quad),
      }),
    )

    // A slow two-beat breath under the plate.
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
  }, [isStatic, glow, draw, plateOpacity, plateScale])

  const plateStyle = useAnimatedStyle(() => ({
    opacity: plateOpacity.value,
    transform: [{ scale: plateScale.value }],
  }))

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value * 0.55,
    transform: [{ scale: 1 + glow.value * 0.13 }],
  }))

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: size / 2,
            backgroundColor: colors.plateFrom,
            // A cheap bloom. `boxShadow` rather than the shadow* props, and
            // `pointerEvents` in style rather than as a prop — both of the old
            // forms are deprecated in React Native 0.86 and warn every render.
            boxShadow: `0px 0px ${size * 0.42}px ${colors.plateFrom}`,
            pointerEvents: 'none',
          },
          glowStyle,
        ]}
      />

      <Animated.View style={plateStyle}>
        <Svg width={size} height={size} viewBox={`0 0 ${VIEW} ${VIEW}`}>
          <Defs>
            <LinearGradient id="plate" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={colors.plateFrom} />
              <Stop offset="1" stopColor={colors.plateTo} />
            </LinearGradient>
          </Defs>

          <Circle cx={VIEW / 2} cy={VIEW / 2} r={VIEW / 2} fill="url(#plate)" />

          {RIDGES.map((_, i) => (
            <Ridge key={i} index={i} draw={draw} />
          ))}
        </Svg>
      </Animated.View>
    </View>
  )
}

/** One fingerprint ridge, revealed by dash offset as `draw` crosses its slot. */
function Ridge({ index, draw }: { index: number; draw: SharedValue<number> }) {
  const ridge = RIDGES[index]
  const length = ridgeLength(ridge) * VIEW

  const animatedProps = useAnimatedProps(() => {
    'worklet'
    const local = Math.min(1, Math.max(0, draw.value - index))
    return { strokeDashoffset: length * (1 - local) }
  })

  return (
    <AnimatedPath
      d={ridgePath(ridge, VIEW)}
      stroke={colors.onBrand}
      strokeWidth={5.2}
      strokeLinecap="round"
      fill="none"
      strokeDasharray={length}
      animatedProps={animatedProps}
    />
  )
}
