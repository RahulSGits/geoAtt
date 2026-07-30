# geoAtt — React Native

A single app for **iOS, Android and the web**, from one React Native codebase.
Expo compiles the same tree to native on both stores and to a static site
through React Native Web — the three targets never diverge because there is
only ever one implementation.

Auth and data are **Supabase — the same project as the web app in
`../frontend`**, so an account provisioned by HR on the web signs straight into
the phone app. One backend, one set of accounts, every platform.

## Stack

| Layer | Choice |
| --- | --- |
| Runtime | Expo SDK 57 / React Native 0.86 / React 19 |
| Routing | expo-router (file-based, typed routes) |
| Auth + data | Supabase (`@supabase/supabase-js`), shared with the web app |
| Animation | react-native-reanimated 4 (UI-thread) |
| Vector | react-native-svg |
| Web | React Native Web, exported static |
| Builds | EAS Build → `.aab` for Play, `.ipa` for App Store |

No `babel.config.js`: `babel-preset-expo` wires the Reanimated plugin in SDK 57,
and adding one applies it twice.

## Setup

```bash
npm install
cp .env.example .env      # then fill in the Supabase URL + publishable key
npm start
```

Both values come from Supabase → Project Settings → API keys. They are **not
secrets** — the publishable key ships inside every client binary by design, and
Row Level Security is the boundary. Never put the service-role key anywhere
near this app: anything `EXPO_PUBLIC_*` is compiled into the bundle for anyone
to read.

Until `.env` is filled in the app still runs — the sign-in card shows a notice
and disables the button rather than crashing. That is deliberate:
`createClient('')` throws synchronously at module scope, which would take down
the whole render tree and show a white screen instead of an explanation. (The
Firebase client this replaced had the identical failure mode.)

### Database

The schema lives at the repo root in [`../db/migrations`](../db/migrations) —
13 numbered files, or [`../db/apply-all.sql`](../db/apply-all.sql) pasted once
into the Supabase SQL editor. This app assumes that schema: the employee-ID
login path calls the `email_for_login` RPC, and every data screen reads the
tables it defines.

### Accounts

**There is no sign-up, on purpose.** geoAtt has no public registration on any
platform — accounts are provisioned by an administrator or HR, and this app
only signs into ones that already exist. The auth layer exports no register
function at all, so a future screen cannot quietly wire one back up.

Sign in with **either an email address or an employee code** (`EMP-0001`). The
code is resolved server-side by a SECURITY DEFINER RPC that returns only an
email, and every failure falls through to the same generic error — so the field
cannot be used to enumerate which codes exist.

## Run

```bash
npm run web        # fastest loop — the splash and auth screens in a browser
npm run ios        # needs Xcode
npm run android    # needs Android Studio + JDK 21
```

`npm run web` needs neither Xcode nor Android Studio, which makes it the
practical way to iterate on layout and animation.

## The splash

`app/index.tsx` plus `components/GeoAttLogo.tsx`. The timeline lives in
`splashTiming` in `lib/theme.ts` — one object, read top to bottom:

| ms | Beat |
| --- | --- |
| 0 | Plate springs up from 0.62 with a soft overshoot |
| 240 | Fingerprint ridges draw themselves, centre outward |
| 900 | "geoAtt" fades and rises 18px |
| 1120 | Tagline fades in; loading dots begin |
| 1560 | Glow starts a slow two-beat breath |
| 2500 | Whole stack lifts 26px and fades, then routes on |

The ridges are revealed with `strokeDashoffset`, not opacity — that is what
makes them read as *drawn* rather than faded in. One shared value sweeps the
whole stack, each ridge reading its own slice, so the ridge count can change
without changing the hook count. Everything runs as animated SVG props on the
UI thread and holds 60fps while Metro is still resolving the bundle.

Navigation fires from the exit fade's completion callback rather than a
`setTimeout`, so a slow device can never route mid-stroke.

## Brand assets

```bash
npm run icons
```

`tools/generate-assets.mjs` draws every PNG from signed distance fields and
writes them with Node's built-in zlib — no dependencies.

The fingerprint geometry lives **once**, in `lib/logo-geometry.json`, read by
both the animated SVG (as arc paths) and this rasteriser (as distance fields).
The native splash shows the PNG, then `app/index.tsx` fades the SVG in on top;
a single definition is what keeps that handoff seamless. The arcs are centred
on (0.5, 0.664), not the plate's centre — the ridges only sweep the upper part
of the circle, so true centring left the mark sitting high with the bottom
third of the store icon empty.

## Publishing — web

```bash
npm run build:web      # static export into dist/
npm run serve:web      # check it locally first, on :8090
```

Deploy `dist/` to any static host. It needs three settings, all reproduced by
`serve:web` so you can verify before deploying: a catch-all rewrite to
`/index.html` (the export is a single-page app — `/login` has no file on
disk), immutable caching on `/_expo/**` (hashed filenames), and **no** caching
on `index.html` (or a deploy ships new assets to browsers holding the old
shell).

## Publishing — iOS and Android

```bash
npm i -g eas-cli && eas login && eas init
```

```bash
npm run build:preview      # installable test builds, both platforms
```

```bash
npm run build:android      # .aab for Play Console
```

```bash
npm run build:ios          # .ipa for App Store Connect
```

EAS builds on hosted macOS/Linux, so **an iOS build does not need a Mac** — it
does need a paid Apple Developer account ($99/yr). Play Console is a one-time
$25.

Before a store build, bump `version` in `app.json`. `eas.json` sets
`autoIncrement` on the production profile, so `buildNumber` / `versionCode`
advance on their own.

### Store checklist

- [ ] `.env` filled with the production Supabase project
- [ ] Schema applied (`../db/apply-all.sql`) and accounts provisioned
- [ ] Bundle ID `com.geoatt.mobile` registered on both consoles
- [ ] Privacy policy URL — **both** stores reject without one
- [ ] Data safety form (Play) and privacy nutrition labels (App Store) —
      declare email collection

## Layout across three targets

React Native lays out to the viewport, which is fine on a phone and wrong in a
desktop browser — every screen stretched edge to edge, giving a 1900px-wide
password field. [`components/Screen.tsx`](components/Screen.tsx) caps the
content column at 440px and centres it, leaving the gradient full-bleed behind.
One component, no media queries, and the same tree reads correctly at 375px and
at 2560px.

The splash keeps its own gradient rather than using `Screen`: it fades the
backdrop out as one unit with the mark, which an always-opaque shared background
would sit behind and spoil.

## What's built

Splash → sign in → home, with sessions that survive a cold start (AsyncStorage
persistence on native; on web the default browser storage is already right).
Token refresh runs only while the app is foregrounded, per Supabase's React
Native guidance.

`app/home.tsx` is the seam where attendance features go. Not built yet:
check-in, history, leave, notifications. Nothing here presumes how those work —
they will read the same tables the web app already defines.
