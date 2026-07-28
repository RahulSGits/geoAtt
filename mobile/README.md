# FinAtt — iOS & Android

Native app shells for the FinAtt website. **One codebase, one backend, one
database** — these projects add a native container; they do not fork the app.

Nothing in `frontend/`, `backend/`, `fastapi-backend/` or `supabase/` was
changed to make this work, and nothing needs to be.

## How it works

The shells are [Capacitor](https://capacitorjs.com) 8 projects — a real Xcode
project and a real Android Studio project — whose WebView loads the **deployed**
Next.js app over HTTPS. Sign-in, Supabase Realtime, Storage, the face pipeline
and every server action run exactly as they do in a desktop browser, against the
same Supabase project.

The app is not bundled into the binary, and cannot be: FinAtt runs on Server
Actions, SSR and `src/proxy.ts` role routing, all of which need a live Node
server. A static export would drop all three. Pointing the WebView at the
running site is what keeps web and mobile in lockstep — ship the website and
both apps are updated, no store review.

What the native layer actually contributes:

| | |
| --- | --- |
| Camera | WKWebView / Android WebView hand `getUserMedia` to the OS permission prompt |
| GPS | `navigator.geolocation` → native Core Location / FusedLocation |
| Identity | Home-screen icon, splash, app name, store presence |
| Lifecycle | Status bar colour, keyboard resize, splash timing |

## Prerequisites

| For | Need | Check |
| --- | --- | --- |
| Both | Node 22+ | `node -v` |
| Android | Android Studio + SDK 36, JDK 21 | `java -version` |
| iOS | Xcode 16+ (full app, not Command Line Tools) | `xcodebuild -version` |

CocoaPods is **not** required — Capacitor 8 uses Swift Package Manager.

If `xcode-select -p` prints `/Library/Developer/CommandLineTools`, install Xcode
from the App Store and repoint it:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

## Configure

One value decides what the app loads. Copy the template and set it:

```bash
cp .env.example .env
```

```text
FINATT_APP_URL=https://your-deployment.vercel.app
```

Then push it into both native projects:

```bash
npm install && npm run sync
```

Re-run `npm run sync` after every change to `.env` or `capacitor.config.ts`.
If the value is empty the app shows a "No app URL configured" page instead of a
white screen.

### Local development

`frontend`'s dev script already binds `0.0.0.0`, so a phone on the same Wi-Fi can
reach it. Use the Mac's LAN address — `localhost` inside a phone is the phone:

```bash
ipconfig getifaddr en0
```

> **Face check-in will not work over plain `http`.** WebKit and Chromium both
> gate `getUserMedia` behind a secure context, and no native setting overrides
> that. Everything else — sign-in, dashboards, leave, maps — works fine, so
> plain http is good enough for layout and navigation work.
>
> To exercise the camera locally, get an https URL for the dev server:
>
> ```bash
> cloudflared tunnel --url http://localhost:3000
> ```
>
> `next.config.ts` already allow-lists `*.trycloudflare.com` in `allowedDevOrigins`.

Cleartext http is enabled for **debug builds only**, via
`android/app/src/debug/AndroidManifest.xml` and `NSAllowsLocalNetworking` on iOS.
Release builds enforce TLS.

## Run

```bash
npm run open:android    # opens Android Studio — press Run
npm run open:ios        # opens Xcode — pick a device, press Run
```

Or straight to a connected device:

```bash
npm run run:android
```

A debug APK without opening the IDE:

```bash
npm run build:android
```

It lands in `android/app/build/outputs/apk/debug/app-debug.apk` — installable by
`adb install` or by sending the file to a phone.

## Release builds

**Android.** Set the version in `android/app/build.gradle` (`versionCode`,
`versionName`), create an upload keystore, then:

```bash
npm run bundle:android
```

Upload `android/app/build/outputs/bundle/release/app-release.aab` to Play
Console. For MDM or direct install, use `assembleRelease` for an APK instead.

**iOS.** Set the team and bundle ID in Xcode → Signing & Capabilities, bump
`MARKETING_VERSION` and `CURRENT_PROJECT_VERSION`, then Product → Archive →
Distribute.

Before either: confirm `FINATT_APP_URL` is the production https origin and
re-run `npm run sync`. A store build carrying a LAN IP installs fine and then
shows a blank screen off the office Wi-Fi.

### A note on App Store review

Apple's Guideline 4.2 (Minimum Functionality) is sometimes applied to apps that
mainly present a website. FinAtt has a real defence — camera-based face
verification and GPS geofencing are device capabilities, not web content — but
review outcomes vary.

For an internal HR tool the friction-free routes avoid public review entirely:

- **TestFlight** — up to 100 internal testers, review is light
- **Apple Business Manager custom apps** — private distribution to your org
- **MDM** — push the app to managed devices

Android has no equivalent hurdle: Play Console internal testing, or hand out the
APK directly.

## Permissions

Declared in `ios/App/App/Info.plist` and
`android/app/src/main/AndroidManifest.xml`:

| Permission | Why | Where the prompt fires |
| --- | --- | --- |
| Camera | Face match + blink liveness | First check-in |
| Location (fine) | Geofence against the assigned site | First check-in |
| Photo library / media | Profile picture, HR CSV import | File picker |

Microphone is deliberately **not** requested — `FaceCheckIn.tsx` passes
`audio: false`, and declaring an unused permission invites a rejection.

The check-in flow already re-verifies the face match and the geofence
server-side, so nothing here weakens the existing security model.

## Icons and splash

`tools/generate-icons.mjs` draws both from signed distance fields and writes PNG
with Node's built-in zlib — no `sharp`, no ImageMagick, no dependencies:

```bash
node tools/generate-icons.mjs && npm run sync
```

Edit the palette or the `MARK` geometry at the top of that file to change the
artwork. The gradient is duplicated in
`android/app/src/main/res/drawable/ic_launcher_bg.xml` for the adaptive-icon
background layer — keep the two in step.

## Known constraints

Worth reading before you commit to store distribution — none of these are
blockers, but they are all real.

- **No offline mode.** Capacitor's own docs describe `server.url` as a
  development feature, because the usual model is bundling static assets into
  the binary. FinAtt cannot do that — Server Actions and SSR need a server — so
  the WebView always talks to the network, and the app shows a connection error
  with no signal rather than a cached shell. For an attendance tool that writes
  every action to Postgres anyway, offline was never on the table.
- **Email links open in the system browser, not the app.** Invites and password
  resets point at `${SITE_URL}/auth/callback`. Tapped on a phone they land in
  Safari or Chrome, so the member sets their password *there* and then signs in
  again inside the app. Fixing it properly means Universal Links (iOS) and App
  Links (Android), which need `apple-app-site-association` and
  `assetlinks.json` served from the deployment — a frontend change, so it has
  been left alone.
- **~38 MB of face weights** (`public/models` + `public/mediapipe`) download on
  first check-in. `/models` is served `immutable`; `/mediapipe` is not, so the
  25 MB WASM bundle refetches whenever the WebView cache is evicted. Adding
  `/mediapipe/:path*` to the `headers()` block in `frontend/next.config.ts`
  would fix that — also a frontend change, also left alone.
- **Face matching runs in the WebView**, on WASM and tfjs. It works, but a
  low-end Android device will take noticeably longer per frame than a laptop.
- **The apps follow the deployment.** A broken deploy breaks both installed
  apps immediately — the flip side of never needing a store update to ship.
