import Svg, { Circle, Path, Rect } from 'react-native-svg'

/**
 * The four glyphs the auth screens need, drawn inline.
 *
 * A full icon package would be ~2 MB of vectors for these four, and every
 * option worth having is another native dependency to keep in step with the
 * Expo SDK. Stroked 24×24 paths on the existing react-native-svg cost nothing.
 */
type IconProps = { size?: number; color?: string }

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
})

export function MailIcon({ size = 20, color = '#94A3B8' }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path
        d="M3 7.5A2.5 2.5 0 0 1 5.5 5h13A2.5 2.5 0 0 1 21 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-9Z"
        stroke={color}
        strokeWidth={1.7}
      />
      <Path
        d="m4 8 7.1 4.7a1.6 1.6 0 0 0 1.8 0L20 8"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </Svg>
  )
}

export function LockIcon({ size = 20, color = '#94A3B8' }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path
        d="M5 11.5A1.5 1.5 0 0 1 6.5 10h11a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 17.5 20h-11A1.5 1.5 0 0 1 5 18.5v-7Z"
        stroke={color}
        strokeWidth={1.7}
      />
      <Path d="M8 10V7.5a4 4 0 1 1 8 0V10" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
      <Circle cx={12} cy={14.8} r={1.4} fill={color} />
    </Svg>
  )
}

export function EyeIcon({ size = 20, color = '#94A3B8' }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={12} r={3.1} stroke={color} strokeWidth={1.7} />
    </Svg>
  )
}

export function EyeOffIcon({ size = 20, color = '#94A3B8' }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path
        d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.9 3.7M6.4 7.6A17 17 0 0 0 2.5 12S6 18.5 12 18.5c1.2 0 2.3-.2 3.3-.6"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9.9 9.9a3 3 0 0 0 4.2 4.2"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <Path d="m4 4 16 16" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
    </Svg>
  )
}

/** Stat-tile glyphs, mirroring the lucide icons the web's StatCards use. */
export function BadgeCheckIcon({ size = 15, color = '#047857' }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path
        d="M12 2.8 14 4.6l2.7-.2.6 2.6 2.3 1.4-1.2 2.4 1.2 2.4-2.3 1.4-.6 2.6-2.7-.2-2 1.8-2-1.8-2.7.2-.6-2.6L2.4 13l1.2-2.4L2.4 8.2l2.3-1.4.6-2.6 2.7.2Z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Path d="m9 12 2 2 4-4" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function TimerIcon({ size = 15, color = '#1E40AF' }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Circle cx={12} cy={13} r={8} stroke={color} strokeWidth={1.7} />
      <Path d="M12 9v4l2.5 1.5M9 2h6" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
    </Svg>
  )
}

export function TrendIcon({ size = 15, color = '#B45309' }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path
        d="M3 16.5 9 10l4 4 7.5-7.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M15 6h6v6" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function CalendarCheckIcon({ size = 15, color = '#1D4ED8' }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Rect x={3.5} y={5} width={17} height={15} rx={2.5} stroke={color} strokeWidth={1.7} />
      <Path d="M3.5 9.5h17M8 3.5V6M16 3.5V6" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
      <Path d="m9 14 2 2 4-4" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}
