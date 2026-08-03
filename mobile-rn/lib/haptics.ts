import { Platform } from 'react-native'
import * as Haptics from 'expo-haptics'

/**
 * Haptic feedback for actions that change something.
 *
 * Wrapped rather than called directly for two reasons. Web has no Taptic
 * Engine and `expo-haptics` rejects there, so an unguarded call turns a
 * successful check-in into a caught error for no reason. And every call is
 * fire-and-forget: feedback that fails is never worth failing the action it
 * was decorating.
 *
 * Used sparingly and only where something was committed — a check-in, a leave
 * request, an error. Buzzing on navigation is what makes an app feel cheap
 * rather than considered.
 */
const enabled = Platform.OS === 'ios' || Platform.OS === 'android'

export const haptics = {
  /** A write succeeded. */
  success() {
    if (enabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
  },
  /** A write was refused — a geofence miss, an overlapping leave. */
  error() {
    if (enabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
  },
  /** A meaningful selection, like switching leave type. */
  select() {
    if (enabled) void Haptics.selectionAsync().catch(() => {})
  },
}
