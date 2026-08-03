import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { AuthProvider } from '../lib/auth'
import { ThemeProvider, useTheme } from '../lib/scheme'


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

/**
 * Status bar and route background, driven by the active scheme.
 *
 * Split into its own component because it has to sit *inside* ThemeProvider to
 * read the scheme — a hook in RootLayout would run above the provider it needs.
 */
function Themed() {
  const { scheme } = useTheme()
  // `style` is the content colour, so it inverts the scheme: light text on a
  // dark bar. No backgroundColor — expo-status-bar dropped it, and on iOS the
  // bar has always been transparent over the screen behind it anyway.
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <Themed />
            <Stack
              screenOptions={{
                headerShown: false,
                
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
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
