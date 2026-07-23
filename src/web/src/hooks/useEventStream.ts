import { useEffect, useRef, useState } from 'react'
import type { GatewayEvent } from '@/types/events'

interface UseEventStreamOptions {
  /** comma-separated levels, e.g. 'warn,error'; omit for all */
  level?: string
  /** event type filter */
  type?: string
  /** max events kept in memory (default 20) */
  maxEvents?: number
  /** set false to close the stream (e.g. tab hidden) */
  enabled?: boolean
}

interface EventStreamState {
  /** newest-first live events received since mount */
  events: GatewayEvent[]
  connected: boolean
}

/**
 * Subscribes to GET /api/events/stream (SSE) and accumulates live events.
 * Reconnects automatically (native EventSource behavior); pauses when the
 * tab is hidden or `enabled` is false.
 */
export function useEventStream(options?: UseEventStreamOptions): EventStreamState {
  const { level, type, maxEvents = 20, enabled = true } = options ?? {}
  const [events, setEvents] = useState<GatewayEvent[]>([])
  const [connected, setConnected] = useState(false)
  const sourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') {
      setConnected(false)
      return
    }

    const params = new URLSearchParams()
    if (level) params.set('level', level)
    if (type) params.set('type', type)
    const url = `/api/events/stream${params.size > 0 ? `?${params.toString()}` : ''}`

    const source = new EventSource(url)
    sourceRef.current = source

    source.onopen = () => setConnected(true)
    source.onerror = () => setConnected(false)
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data as string) as GatewayEvent
        setEvents((previous) => [event, ...previous].slice(0, maxEvents))
      } catch {
        // ignore malformed frames (e.g. keep-alive comments arrive as empty data)
      }
    }

    return () => {
      source.close()
      sourceRef.current = null
      setConnected(false)
    }
  }, [enabled, level, type, maxEvents])

  return { events, connected }
}
