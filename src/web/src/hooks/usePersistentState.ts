import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

interface UsePersistentStateOptions<T> {
  serialize?: (value: T) => string
  deserialize?: (raw: string) => T
}

function resolveInitialValue<T>(initialValue: T | (() => T)): T {
  return typeof initialValue === 'function'
    ? (initialValue as () => T)()
    : initialValue
}

export function usePersistentState<T>(
  key: string,
  initialValue: T | (() => T),
  options: UsePersistentStateOptions<T> = {}
): [T, Dispatch<SetStateAction<T>>] {
  const { serialize = JSON.stringify, deserialize = JSON.parse as (raw: string) => T } = options

  const [state, setState] = useState<T>(() => {
    const fallback = resolveInitialValue(initialValue)
    if (typeof window === 'undefined') {
      return fallback
    }

    // 存储整体被禁用时,访问 window.localStorage 本身就会抛(返回 null),
    // 与"键不存在返回 null"一样落回初始值。
    let raw: string | null
    try {
      raw = window.localStorage.getItem(key)
    } catch {
      return fallback
    }
    if (raw === null) {
      return fallback
    }

    try {
      return deserialize(raw)
    } catch {
      return fallback
    }
  })

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    try {
      window.localStorage.setItem(key, serialize(state))
    } catch {
    }
  }, [key, state])

  return [state, setState]
}
