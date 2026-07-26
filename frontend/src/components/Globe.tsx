'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Rotating point-globe on a canvas. Points sit on a sphere via a Fibonacci
 * distribution, rotate in 3D, project to 2D, and are drawn with depth-based
 * size and opacity. Pure maths — no 3D library.
 */
export default function Globe({ size = 360 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [rgb, setRgb] = useState<[number, number, number]>([99, 102, 241])

  // Track the themed accent so the globe recolours with light/dark instead of
  // staying a hardcoded indigo.
  useEffect(() => {
    const read = () => {
      const value = getComputedStyle(document.documentElement)
        .getPropertyValue('--primary')
        .trim()
      const parsed = parseColor(value)
      if (parsed) setRgb(parsed)
    }

    read()
    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.scale(dpr, dpr)

    const COUNT = 520
    const radius = size * 0.36
    const golden = Math.PI * (3 - Math.sqrt(5))
    const points: { x: number; y: number; z: number }[] = []

    for (let i = 0; i < COUNT; i++) {
      const y = 1 - (i / (COUNT - 1)) * 2
      const r = Math.sqrt(1 - y * y)
      const t = golden * i
      points.push({ x: Math.cos(t) * r, y, z: Math.sin(t) * r })
    }

    const cx = size / 2
    const cy = size / 2
    const tilt = 0.42
    const [pr, pg, pb] = rgb

    let raf = 0
    let angle = 0

    const render = () => {
      angle += 0.0035
      ctx.clearRect(0, 0, size, size)

      const sinA = Math.sin(angle)
      const cosA = Math.cos(angle)

      const projected = points.map((p) => {
        const x = p.x * cosA - p.z * sinA
        const z = p.x * sinA + p.z * cosA
        const y = p.y * Math.cos(tilt) - z * Math.sin(tilt)
        const depth = p.y * Math.sin(tilt) + z * Math.cos(tilt)
        return { sx: cx + x * radius, sy: cy + y * radius, depth }
      })
      projected.sort((a, b) => a.depth - b.depth)

      for (const p of projected) {
        const t = (p.depth + 1) / 2
        ctx.beginPath()
        ctx.fillStyle = `rgba(${pr}, ${pg}, ${pb}, ${0.15 + t * 0.7})`
        ctx.arc(p.sx, p.sy, 0.6 + t * 1.9, 0, Math.PI * 2)
        ctx.fill()
      }

      if (!reduceMotion) raf = requestAnimationFrame(render)
    }

    render()
    return () => cancelAnimationFrame(raf)
  }, [size, rgb])

  return <canvas ref={ref} style={{ width: size, height: size }} className="float" aria-hidden />
}

/** Parse `#rrggbb`, `#rgb` or `rgb(r g b)` into a channel triple. */
function parseColor(value: string): [number, number, number] | null {
  if (value.startsWith('#')) {
    const hex = value.slice(1)
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex
    if (full.length !== 6) return null
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ]
  }

  const nums = value.match(/\d+(\.\d+)?/g)
  if (nums && nums.length >= 3) {
    return [Number(nums[0]), Number(nums[1]), Number(nums[2])]
  }
  return null
}
