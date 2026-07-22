import { useEffect, useRef, useState } from 'react'

interface CountUpProps {
  value: number
  /** animation length in ms; ignored under prefers-reduced-motion */
  duration?: number
  format?: (value: number) => string
  className?: string
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

const defaultFormat = (value: number) => Math.round(value).toLocaleString()

/**
 * Renders the final value immediately on mount, then animates toward any
 * subsequent `value` change (e.g. a live data refresh) with an ease-out count.
 * Animating only on change — not from zero on every load — keeps the number
 * correct on first paint (better perceived performance, snapshot-stable) while
 * still giving the dashboard a live "pulse" as metrics refresh. Renders the
 * final value with no animation when the user prefers reduced motion.
 */
export function CountUp({ value, duration = 600, format = defaultFormat, className }: CountUpProps) {
  const reduceMotion = useRef(prefersReducedMotion()).current
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  const rafRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    const from = fromRef.current
    const to = value
    fromRef.current = value

    if (reduceMotion || !Number.isFinite(to) || from === to) {
      setDisplay(to)
      return
    }

    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      setDisplay(from + (to - from) * easeOutCubic(t))
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
    }
  }, [value, duration, reduceMotion])

  return <span className={className}>{format(display)}</span>
}
