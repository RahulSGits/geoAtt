import { useEffect, useState } from 'react'
import { Text, type TextStyle } from 'react-native'

/**
 * The date and running time, matching the web's LiveClock in the employee
 * header.
 *
 * Ticks on a 1s interval rather than requestAnimationFrame: the display only
 * changes once a second, so anything finer is work thrown away — and on a
 * phone that is battery. The interval is cleared on unmount, which matters
 * more here than on the web, because a backgrounded RN screen stays mounted.
 */
export default function LiveClock({ style }: { style?: TextStyle }) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const date = now.toLocaleDateString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  const time = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  return <Text style={style}>{`${date} · ${time}`}</Text>
}
