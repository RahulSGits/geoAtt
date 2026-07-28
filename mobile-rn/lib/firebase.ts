import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  getAuth,
  initializeAuth,
  // @ts-expect-error — shipped by firebase/auth at runtime for React Native but
  // deliberately absent from the public types, which describe the web build.
  getReactNativePersistence,
  type Auth,
} from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'

/**
 * Config comes from EXPO_PUBLIC_* variables, which Expo inlines at build time.
 *
 * These are *not* secrets. Firebase web config is public by design — every
 * client ships it and it is readable in any decompiled binary. What actually
 * protects the data is Firestore security rules plus Firebase Auth. Never put
 * a service-account key in here.
 */
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
}

/** True once every required key is present — the UI uses this to explain itself. */
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
)

/**
 * On native, auth state must be persisted through AsyncStorage or the user is
 * signed out on every cold start — `getAuth()` alone defaults to in-memory
 * there. On web the browser persistence layer is already correct.
 */
function createAuth(app: FirebaseApp): Auth {
  if (Platform.OS === 'web') return getAuth(app)
  try {
    return initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) })
  } catch {
    // Already initialized by an earlier Fast Refresh pass.
    return getAuth(app)
  }
}

/**
 * Everything below stays null until the config is actually present.
 *
 * This has to be lazy. Calling `getAuth()` with an empty apiKey throws
 * `auth/invalid-api-key` synchronously at *module scope*, which takes down the
 * whole render tree — so a fresh clone with no .env showed a white screen
 * instead of the "Firebase isn't configured" notice on the sign-in card.
 * Failing soft here is what lets that notice render at all.
 */
let appRef: FirebaseApp | null = null
let authRef: Auth | null = null
let dbRef: Firestore | null = null

if (isFirebaseConfigured) {
  // Metro keeps modules alive across Fast Refresh, so initializing twice throws
  // "Firebase App named '[DEFAULT]' already exists". Reuse whatever exists.
  appRef = getApps().length ? getApp() : initializeApp(firebaseConfig)
  authRef = createAuth(appRef)
  dbRef = getFirestore(appRef)
}

export const app = appRef
export const auth = authRef
export const db = dbRef

/**
 * Narrowing helper for the call sites that genuinely need auth. Throws a
 * message aimed at whoever is setting the project up, not at an end user.
 */
export function requireAuth(): Auth {
  if (!authRef) {
    throw new Error(
      'Firebase is not configured. Copy mobile-rn/.env.example to .env and fill in your project keys.',
    )
  }
  return authRef
}
