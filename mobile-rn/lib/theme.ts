/**
 * One source of truth for colour and type.
 *
 * Both palettes are copied from the web app's CSS custom properties in
 * `frontend/src/app/globals.css` — `:root` for light, `.dark` for dark — same
 * hexes, same names where the concept matches. The two apps are one product,
 * and a phone screen that is a different blue from the console it mirrors reads
 * as a different product.
 *
 * Note the web's comment on --text-muted: it is 5.3:1 on the page background,
 * chosen for contrast rather than as decorative grey. Don't lighten these
 * without re-checking that.
 *
 * Note also that the brand colour differs between schemes, and that is
 * deliberate on the web's part: #1E40AF is a deep navy that reads as almost
 * black on a dark surface, so dark mode uses the much lighter #818CF8. Copying
 * the light brand into dark would produce an invisible primary button.
 */

export type Scheme = 'light' | 'dark'

export type Palette = {
  bg: string
  surface: string
  surfaceSunken: string
  surfaceRaised: string
  hairline: string
  hairlineStrong: string

  ink: string
  inkMuted: string
  inkFaint: string

  brand: string
  brandHover: string
  brandSoft: string
  onBrand: string

  success: string
  successSoft: string
  warning: string
  warningSoft: string
  danger: string
  dangerSoft: string
  info: string
  infoSoft: string

  /** The splash gradient. Identical in both schemes — see below. */
  backdrop: readonly [string, string, string]
  onBackdrop: string
  onBackdropMuted: string
  onBackdropFaint: string

  plateFrom: string
  plateTo: string
}

/**
 * The splash is the same in both schemes on purpose. It stands in for the OS
 * launch image, which is a single static asset chosen at build time — there is
 * no way to swap it per scheme, so a scheme-aware animated splash would visibly
 * disagree with the native one it hands over from.
 */
const SPLASH = {
  backdrop: ['#0A1230', '#152C7A', '#1D4ED8'] as const,
  onBackdrop: '#FFFFFF',
  onBackdropMuted: 'rgba(255,255,255,0.62)',
  onBackdropFaint: 'rgba(255,255,255,0.30)',
  plateFrom: '#3B82F6',
  plateTo: '#1D4ED8',
}

export const light: Palette = {
  bg: '#F5F7FB',
  surface: '#FFFFFF',
  surfaceSunken: '#EEF2F8',
  surfaceRaised: '#E3E9F3',
  hairline: '#D8E0EC',
  hairlineStrong: '#BCC8DA',

  ink: '#0F172A',
  inkMuted: '#556274',
  inkFaint: '#6B7889',

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

  ...SPLASH,
}

export const dark: Palette = {
  bg: '#070912',
  surface: '#0E1220',
  surfaceSunken: '#151A2B',
  surfaceRaised: '#1C2338',
  hairline: '#232B40',
  hairlineStrong: '#33405C',

  ink: '#E8ECF6',
  inkMuted: '#97A3BA',
  inkFaint: '#7D8AA3',

  brand: '#818CF8',
  brandHover: '#A5B4FC',
  brandSoft: 'rgba(129, 140, 248, 0.15)',
  // The web's --primary-fg: near-black, because #818CF8 is light enough that
  // white text on it fails contrast.
  onBrand: '#0B1020',

  success: '#34D399',
  successSoft: 'rgba(52, 211, 153, 0.15)',
  warning: '#FBBF24',
  warningSoft: 'rgba(251, 191, 36, 0.15)',
  danger: '#F87171',
  dangerSoft: 'rgba(248, 113, 113, 0.15)',
  info: '#60A5FA',
  infoSoft: 'rgba(96, 165, 250, 0.15)',

  ...SPLASH,
}

export const palettes: Record<Scheme, Palette> = { light, dark }

/**
 * Shadows, matching the web's --shadow-sm/md/lg per scheme.
 *
 * Dark mode uses much heavier alpha. A shadow tuned for a white page is
 * invisible against #070912 — elevation there comes from opacity, not from a
 * subtle grey.
 */
export const shadows: Record<Scheme, { sm: string; md: string; lg: string }> = {
  light: {
    sm: '0px 1px 2px rgba(15, 23, 42, 0.06)',
    md: '0px 4px 16px rgba(15, 23, 42, 0.10)',
    lg: '0px 16px 40px rgba(15, 23, 42, 0.16)',
  },
  dark: {
    sm: '0px 1px 2px rgba(0, 0, 0, 0.40)',
    md: '0px 4px 16px rgba(0, 0, 0, 0.50)',
    lg: '0px 16px 40px rgba(0, 0, 0, 0.70)',
  },
}

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

/**
 * Light palette as a module-level export.
 *
 * Kept so the splash and the logo — which are scheme-independent — can import
 * colours without a hook, and so a stylesheet defined at module scope still
 * compiles. Screens that follow the scheme use useTheme() instead.
 */
export const colors = light
