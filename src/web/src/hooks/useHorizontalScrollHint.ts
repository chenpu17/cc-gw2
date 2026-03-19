import { useCallback, useEffect, useRef, useState } from 'react'

export function useHorizontalScrollHint<T extends HTMLElement = HTMLDivElement>() {
  const scrollRef = useRef<T>(null)
  const [showScrollHint, setShowScrollHint] = useState(false)

  const updateScrollHint = useCallback(() => {
    const element = scrollRef.current
    if (!element) {
      return
    }

    const canScrollMore = element.scrollWidth - element.scrollLeft - element.clientWidth > 1
    setShowScrollHint(canScrollMore)
  }, [])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) {
      return
    }

    updateScrollHint()
    element.addEventListener('scroll', updateScrollHint, { passive: true })
    const observer = new ResizeObserver(updateScrollHint)
    observer.observe(element)

    return () => {
      element.removeEventListener('scroll', updateScrollHint)
      observer.disconnect()
    }
  }, [updateScrollHint])

  return {
    scrollRef,
    showScrollHint,
    updateScrollHint
  }
}
