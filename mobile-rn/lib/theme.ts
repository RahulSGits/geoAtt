/**
 * One source of truth for colour and type.
 *
 * The blues are lifted from the launcher icon that already ships with geoAtt
 * (#3B82F6 → #1D4ED8), so the splash reads as the same product as the icon the
 * user just tapped rather than an unrelated screen.
 */
export const colors = {
  // Splash / auth backdrop, deep to bright.
  backdrop: ['#0A1230', '#152C7A', '#1D4ED8'] as const,

  brand: '#2563EB',
  brandLight: '#3B82F6',
  brandDark: '#1D4ED8',

  ink: '#0F172A',
  inkMuted: '#64748B',
  inkFaint: '#94A3B8',

  surface: '#FFFFFF',
  surfaceSunken: '#F1F5F9',
  hairline: '#E2E8F0',

  onBrand: '#FFFFFF',
  onBrandMuted: 'rgba(255,255,255,0.62)',
  onBrandFaint: 'rgba(255,255,255,0.30)',

  danger: '#DC2626',
  dangerSurface: '#FEF2F2',
} as const

export const radius = {
  field: 12,
  card: 24,
  pill: 999,
} as const

/**
 * Splash choreography, in milliseconds from mount. Pulled out of the component
 * so the sequence can be read as a timeline instead of reverse-engineered from
 * a dozen scattered `withDelay` calls.
 */
export const splashTiming = {
  plateIn: 0,
  ringDraw: 240,
  markDraw: 560,
  wordmarkIn: 900,
  taglineIn: 1120,
  pulse: 1560,
  exit: 2500,
  exitDuration: 420,
} as const
