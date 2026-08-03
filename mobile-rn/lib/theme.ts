/**
 * One source of truth for colour and type.
 *
 * These values are copied from the web app's CSS custom properties in
 * `frontend/src/app/globals.css` — same hexes, same names where the concept
 * matches. The two apps are one product, and a phone screen that is a different
 * blue from the console it mirrors reads as a different product.
 *
 * The web comment on --text-muted is worth carrying over: it is 5.3:1 on the
 * page background, chosen for contrast rather than as decorative grey-on-grey.
 * Don't lighten these without re-checking that.
 */
export const colors = {
  /** Page background. `bg` on web. */
  bg: '#F5F7FB',
  surface: '#FFFFFF',
  surfaceSunken: '#EEF2F8',
  surfaceRaised: '#E3E9F3',
  hairline: '#D8E0EC',
  hairlineStrong: '#BCC8DA',

  ink: '#0F172A',
  inkMuted: '#556274',
  inkFaint: '#6B7889',

  /** Brand. `primary` / `primary-hover` on web. */
  brand: '#1E40AF',
  brandHover: '#1D4ED8',
  brandSoft: 'rgba(30, 64, 175, 0.10)',
  onBrand: '#FFFFFF',

  success: '#047857',
  successSoft: 'rgba(4, 120, 87, 0.12)',
  warning: '#B45309',
  warningSoft: 'rgba(180, 83, 9, 0.12)',
  danger: '#B91C1C',
  dangerSoft: 'rgba(185, 28, 28, 0.10)',
  info: '#1D4ED8',
  infoSoft: 'rgba(29, 78, 216, 0.10)',

  /**
   * The splash keeps the deep gradient. It is the one screen with no web
   * counterpart — it stands in for the OS launch image, and a white flash
   * between the native splash and the app is exactly what it exists to avoid.
   */
  backdrop: ['#0A1230', '#152C7A', '#1D4ED8'] as const,
  onBackdrop: '#FFFFFF',
  onBackdropMuted: 'rgba(255,255,255,0.62)',
  onBackdropFaint: 'rgba(255,255,255,0.30)',

  /** Logo plate, matching the launcher icon so the splash reads as the icon. */
  plateFrom: '#3B82F6',
  plateTo: '#1D4ED8',
} as const

/** Matches the web's --shadow-sm / md / lg, as RN boxShadow strings. */
export const shadow = {
  sm: '0px 1px 2px rgba(15, 23, 42, 0.06)',
  md: '0px 4px 16px rgba(15, 23, 42, 0.10)',
  lg: '0px 16px 40px rgba(15, 23, 42, 0.16)',
} as const

export const radius = {
  field: 10,
  card: 16,
  pill: 999,
} as const

/**
 * Splash choreography, in milliseconds from mount. Pulled out of the component
 * so the sequence can be read as a timeline instead of reverse-engineered from
 * a dozen scattered `withDelay` calls.
 */
export const splashTiming = {
  plateIn: 0,
  /** When the fingerprint starts drawing. */
  ridgeDraw: 240,
  /**
   * How long the whole stack of ridges takes. One animation sweeps across all
   * of them, so this is the total rather than the per-ridge duration — the
   * centre-outward stagger falls out of the sweep.
   */
  ridgeDuration: 900,
  wordmarkIn: 900,
  taglineIn: 1120,
  pulse: 1560,
  exit: 2500,
  exitDuration: 420,
} as const
