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
  /** stream gave up reconnecting (e.g. auth lost / server error) — toggle tab visibility or reload to retry */
  failed: boolean
}

/**
 * Subscribes to GET /api/events/stream (SSE) and accumulates live events.
 * Reconnects automatically on transient drops (native EventSource behavior);
 * pauses while the tab is hidden or `enabled` is false, and reports a
 * permanent failure when the browser stops retrying (e.g. 401 / 5xx).
 */
export function useEventStream(options?: UseEventStreamOptions): EventStreamState {
  const { level, type, maxEvents = 20, enabled = true } = options ?? {}
  const [events, setEvents] = useState<GatewayEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [failed, setFailed] = useState(false)
  const sourceRef = useRef<EventSource | null>(null)

  // Honor the "pauses when the tab is hidden" contract: close the stream
  // while the tab is hidden and reopen on return. Toggling visibility is also
  // the recovery path once a permanent failure has been reported.
  const [visible, setVisible] = useState(typeof document === 'undefined' ? true : !document.hidden)
  useEffect(() => {
    if (typeof document === 'undefined') return
    const handleChange = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', handleChange)
    return () => document.removeEventListener('visibilitychange', handleChange)
  }, [])

  const active = enabled && visible

  useEffect(() => {
    if (!active || typeof EventSource === 'undefined') {
      setConnected(false)
      return
    }

    const params = new URLSearchParams()
    if (level) params.set('level', level)
    if (type) params.set('type', type)
    const url = `/api/events/stream${params.size > 0 ? `?${params.toString()}` : ''}`

    const source = new EventSource(url)
    sourceRef.current = source

    source.onopen = () => {
      setConnected(true)
      setFailed(false)
    }
    source.onerror = () => {
      setConnected(false)
      // CLOSED means the browser gave up (e.g. non-200 initial response like
      // 401/5xx) and will not auto-reconnect — surface it instead of pretending
      // we are still "reconnecting".
      if (source.readyState === EventSource.CLOSED) {
        setFailed(true)
      }
    }
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
  }, [active, level, type, maxEvents])

  return { events, connected, failed }
}
