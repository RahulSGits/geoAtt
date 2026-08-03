import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { AuthProvider } from '../lib/auth'
import { colors } from '../lib/theme'

/**
 * Hold the *native* splash until the React tree has mounted. Without this the
 * OS splash tears down the moment the bundle loads and the user sees a blank
 * frame before the animated splash paints — the handoff has to overlap.
 *
 * The native splash is configured in app.json with the same background and
 * mark, so the seam between the two is invisible.
 */
SplashScreen.preventAutoHideAsync().catch(() => {
  // Already hidden — harmless, and never worth crashing a launch over.
})

SplashScreen.setOptions({ duration: 260, fade: true })

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.backdrop[0] },
              animation: 'fade',
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="login" />
            <Stack.Screen name="home" />
            <Stack.Screen name="leave" />
            <Stack.Screen name="profile" />
            {/* HR and admin land here — see lib/roles.ts homeFor(). */}
            <Stack.Screen name="console" />
          </Stack>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
