'use client'

import { useReducedMotion } from 'motion/react'
import { useRef } from 'react'

/** Wraps children in a perspective card that tilts toward the cursor. */
export default function TiltCard({
  children,
  className = '',
  max = 8,
}: {
  children: React.ReactNode
  className?: string
  max?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()

  function handleMove(e: React.PointerEvent) {
    // Skip on touch: there is no hover, so a tap would leave the card stuck at
    // an angle until the next interaction.
    if (reduceMotion || e.pointerType !== 'mouse') return

    const el = ref.current
    if (!el) return

    const rect = el.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width
    const py = (e.clientY - rect.top) / rect.height
    el.style.transform = `rotateX(${(0.5 - py) * max * 2}deg) rotateY(${(px - 0.5) * max * 2}deg)`
  }

  function reset() {
    if (ref.current) ref.current.style.transform = 'rotateX(0deg) rotateY(0deg)'
  }

  return (
    <div className={className} style={{ perspective: 1200 }}>
      <div
        ref={ref}
        onPointerMove={handleMove}
        onPointerLeave={reset}
        style={{
          transformStyle: 'preserve-3d',
          transition: 'transform 150ms ease-out',
          willChange: 'transform',
          height: '100%',
        }}
      >
        {children}
      </div>
    </div>
  )
}
