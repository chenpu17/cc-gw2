import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

export interface ToastOptions {
  id?: string
  title: string
  description?: string
  variant?: 'info' | 'success' | 'error'
  durationMs?: number
}

interface InternalToast extends ToastOptions {
  dismissing?: boolean
}

interface ToastContextValue {
  toasts: InternalToast[]
  pushToast: (toast: ToastOptions) => void
  dismissToast: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

function buildId() {
  return `toast_${Math.random().toString(36).slice(2)}`
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<InternalToast[]>([])
  const toastsRef = useRef<InternalToast[]>([])
  const dismissTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    toastsRef.current = toasts
  }, [toasts])

  const clearDismissTimer = useCallback((id: string) => {
    const timer = dismissTimersRef.current[id]
    if (!timer) {
      return
    }
    clearTimeout(timer)
    delete dismissTimersRef.current[id]
  }, [])

  const removeToast = useCallback((id: string) => {
    clearDismissTimer(id)
    setToasts((prev) => prev.filter((item) => item.id !== id))
  }, [clearDismissTimer])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((item) => (item.id === id ? { ...item, dismissing: true } : item))
    )
    setTimeout(() => removeToast(id), 200)
  }, [removeToast])

  const scheduleDismiss = useCallback((id: string, duration: number) => {
    clearDismissTimer(id)
    if (duration <= 0) {
      return
    }
    dismissTimersRef.current[id] = setTimeout(() => dismissToast(id), duration)
  }, [clearDismissTimer, dismissToast])

  useEffect(() => {
    return () => {
      Object.values(dismissTimersRef.current).forEach((timer) => clearTimeout(timer))
      dismissTimersRef.current = {}
    }
  }, [])

  const pushToast = useCallback(
    (toast: ToastOptions) => {
      const duration = toast.durationMs ?? 3000
      const existingToast = toastsRef.current.find((item) =>
        toast.id
          ? item.id === toast.id
          : item.title === toast.title &&
            item.description === toast.description &&
            item.variant === toast.variant
      )
      const id = existingToast?.id ?? toast.id ?? buildId()
      setToasts((prev) =>
        existingToast
          ? prev.map((item) => (item.id === id ? { ...item, ...toast, id, dismissing: false } : item))
          : [...prev, { ...toast, id }]
      )
      scheduleDismiss(id, duration)
    },
    [scheduleDismiss]
  )

  const value = useMemo(() => ({ toasts, pushToast, dismissToast }), [toasts, dismissToast, pushToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" aria-atomic="false" className="fixed right-6 top-6 z-50 flex w-80 flex-col gap-3">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="alert"
            className={`rounded-md border border-border bg-card p-4 text-card-foreground shadow-lg ${
              toast.dismissing
                ? 'animate-toast-out'
                : 'animate-toast-in'
            } ${
              toast.variant === 'error'
                ? 'border-destructive/20 bg-destructive/10 text-destructive'
                : toast.variant === 'success'
                ? 'border-[hsl(var(--success)/0.2)] bg-[hsl(var(--success-bg))] text-[hsl(var(--success)/1)]'
                : ''
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">{toast.title}</p>
                {toast.description ? <p className="mt-1 text-sm opacity-75">{toast.description}</p> : null}
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                className="text-sm text-muted-foreground hover:text-foreground"
                onClick={() => toast.id && dismissToast(toast.id)}
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}
