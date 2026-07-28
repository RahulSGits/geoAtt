# FinAtt — React Native

A standalone app for **iOS, Android and the web**, from one React Native
codebase. Expo compiles the same tree to native on both stores and to a static
site through React Native Web — the three targets never diverge because there
is only ever one implementation.

**This app does not touch the FinAtt web backend.** It has no connection to the
Supabase project in `../supabase`, reads none of its tables, and shares no
accounts with it. Auth and data are its own, on Firebase.

> Also in this repo: `../mobile`, a Capacitor shell that wraps the existing
> Next.js site and *does* use the Supabase backend. The two are independent —
> pick one to publish. See [Which one should I ship?](#which-one-should-i-ship).

## Stack

| Layer | Choice |
| --- | --- |
| Runtime | Expo SDK 57 / React Native 0.86 / React 19 |
| Routing | expo-router (file-based, typed routes) |
| Auth + data | Firebase — Auth (email/password) and Firestore, free Spark plan |
| Animation | react-native-reanimated 4 (UI-thread) |
| Vector | react-native-svg |
| Web | React Native Web, exported static and served from Firebase Hosting |
| Builds | EAS Build → `.aab` for Play, `.ipa` for App Store |

No `babel.config.js`: `babel-preset-expo` wires the Reanimated plugin in SDK 57,
and adding one applies it twice.

## Setup

```bash
npm install
cp .env.example .env      # then fill it in — see below
npm start
```

### Firebase

Project **attendence-app** (`attendence-app-f7f9d`) is already referenced in
`.env`. Two values are still blank, both produced by registering a Web app:

1. [Project settings → General](https://console.firebase.google.com/project/attendence-app-f7f9d/settings/general)
   → **Your apps** → **Add app** → **Web** (`</>`)
2. Copy `apiKey` and `appId` from the `firebaseConfig` snippet into `.env`
3. [Authentication → Sign-in method](https://console.firebase.google.com/project/attendence-app-f7f9d/authentication/providers)
   → enable **Email/Password**

Skip step 3 and every sign-in fails with `auth/operation-not-allowed`.

Until `.env` is complete the app still runs — the sign-in card shows a notice
and disables the button rather than crashing. That is deliberate: `getAuth()`
throws `auth/invalid-api-key` synchronously at module scope, which would take
down the whole render tree and show a white screen instead of an explanation.

Firebase web config is **not secret** — it ships inside every client binary.
Firestore security rules and Auth are what protect the data. Never put a
service-account key in `.env`.

## Database

The same nine collections the website has as Postgres tables — `profiles`,
`employees`, `attendance`, `leaves`, `announcements`, `notifications`,
`reward_events`, `shifts`, `sites` — with the same field names and value sets.
Types are in [`lib/schema.ts`](lib/schema.ts).

Field names stay snake_case to match `frontend/src/lib/types.ts` exactly, so the
two models can be compared line by line.

Four things Postgres did that Firestore cannot:

| Postgres | Here |
| --- | --- |
| `unique (employee_id, date)` on attendance | Encoded in the document ID via `attendanceId()` — a duplicate day overwrites instead of double-counting |
| Foreign keys with `on delete cascade` | Plain ID strings; deletes must clean up their own children |
| The `compute_attendance_status` trigger | Must run in app code or a Cloud Function — **nothing computes status for you yet** |
| Enums | Union types, enforced by security rules |

[`firestore.rules`](firestore.rules) mirrors the website's RLS, including the
part that matters most: a user may edit their own profile but **never their own
`role`**. Only an admin changes roles. Rules are the only boundary — the
Firebase config is public, so "the app doesn't call that path" is not a control.

### Seeding

Order matters, and getting it wrong produces a confusing error:

```bash
npm run seed
```

```bash
npm run deploy:rules
```

Seed **first**, while Firestore is still in test mode. The rules only let a user
create their own profile as an `employee` — that is exactly what stops anyone
signing up and handing themselves admin — so the admin and HR profiles cannot be
written through them. Running the seed after deploying rules fails with
`permission-denied`, which is correct behaviour, not a bug. Promote accounts from
the Firebase console instead.

The seed creates three accounts, one site, one shift, and a single `employees`
row for the employee demo. **No roster is seeded.** Admin and HR deliberately get
no `employees` row — same as the website, where that absence is what makes
employee-only actions correctly reject an admin.

Passwords come from `DEMO_PASSWORD` in `.env`, never from a default: this repo is
public, and a committed fallback would be a working credential for anyone reading
it.

## Run

```bash
npm run web        # fastest loop — the splash and auth screens in a browser
npm run ios        # needs Xcode
npm run android    # needs Android Studio + JDK 21
```

`npm run web` needs neither Xcode nor Android Studio, which makes it the
practical way to iterate on layout and animation.

## The splash

`app/index.tsx` plus `components/FinAttLogo.tsx`. The timeline lives in
`splashTiming` in `lib/theme.ts` — one object, read top to bottom:

| ms | Beat |
| --- | --- |
| 0 | Plate springs up from 0.62 with a soft overshoot |
| 240 | Ring draws itself clockwise from 12 o'clock |
| 560 | Check strokes in |
| 900 | "FinAtt" fades and rises 18px |
| 1120 | Tagline fades in; loading dots begin |
| 1560 | Glow starts a slow two-beat breath |
| 2500 | Whole stack lifts 26px and fades, then routes on |

The ring and check are revealed with `strokeDashoffset`, not opacity — that is
what makes them read as *drawn* rather than faded in. Both run as animated SVG
props on the UI thread, so the sequence holds 60fps while Metro is still
resolving the rest of the bundle.

Navigation fires from the fade's own completion callback rather than a
`setTimeout`, so a slow device can never route mid-stroke.

The native splash (`app.json` → `expo-splash-screen`) uses the same backdrop and
the same mark at the same 136px width, so the handoff from OS splash to animated
splash is invisible. `assets/splash-icon.png` is generated from the same
geometry as the SVG — see below.

## Brand assets

```bash
npm run icons
```

`tools/generate-assets.mjs` draws every PNG from signed distance fields and
writes them with Node's built-in zlib. No dependencies — the usual choice,
`sharp`, needs a libvips binary that does not install everywhere.

It emits the store icon (opaque — App Store Connect rejects alpha), the splash
mark, the Android adaptive foreground and monochrome layers, and the favicon,
each at its own inset. **Its geometry mirrors `components/FinAttLogo.tsx`** — if
you change one, change both, or the splash handoff visibly jumps.

## Publishing — web

```bash
npm run build:web      # static export into dist/
npm run serve:web      # check it locally first, on :8090
npm run deploy:web     # build + push to Firebase Hosting
```

`npm run serve:web` exists because a plain static server is not a fair test.
`web.output` is `"single"`, so `/login` has no file on disk — an ordinary server
404s it and you would only find out after deploying. That script reproduces the
SPA rewrite from `firebase.json`, so deep links and refreshes are exercised the
way hosting will actually serve them.

Hosting headers are set so `/_expo/**` (hashed filenames) is cached forever
while `index.html` never is — otherwise a deploy ships new assets to browsers
still holding the old shell.

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

`eas submit` uploads. For Android it wants a Play service-account JSON at
`./play-service-account.json` — gitignored, and it must stay that way.

### Store checklist

- [ ] `apiKey` and `appId` filled in `.env`, Email/Password enabled
- [ ] Bundle ID `com.finatt.mobile` registered on both consoles
- [ ] Privacy policy URL — **both** stores reject without one
- [ ] Apple: if you later add Google sign-in, Sign in with Apple becomes
      mandatory alongside it
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

Splash → sign in / register → home, with sessions that survive a cold start
(AsyncStorage persistence; `getAuth()` alone is in-memory on native and would
sign the user out every launch).

`app/home.tsx` is the seam where attendance features go. Not built yet: check-in,
history, leave, admin. Nothing here presumes how those work.

## Which one should I ship?

| | `mobile-rn` (this) | `mobile` (Capacitor) |
| --- | --- | --- |
| Backend | Firebase, standalone | Existing Supabase |
| Existing accounts and face enrollments | Not used | Fully preserved |
| Attendance features | To be built | Already complete |
| UI changes reach users | Rebuild + store review | Deploy the website — instant |

Ship this one for a fresh, independent product. Ship `../mobile` to put the
existing FinAtt platform in employees' hands now.
