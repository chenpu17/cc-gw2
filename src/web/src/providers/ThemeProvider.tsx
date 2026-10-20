import { createContext, useContext, useEffect, useMemo } from 'react'
import { usePersistentState } from '@/hooks/usePersistentState'
import { storageKeys } from '@/services/storageKeys'

export type ThemeMode = 'light' | 'dark' | 'system'

/** 风格家族(data-skin 轴),与明暗模式(data-theme 轴)正交。 */
export const SKINS = ['minimal', 'classic', 'paper', 'glass', 'modernist'] as const
export type Skin = (typeof SKINS)[number]
/** 默认家族旋钮:首次打开/存储不可用/存储值非法时生效,须与
 *  themes/minimal.css(:root)、index.html pre-paint 脚本、视觉基线钉值保持一致。 */
export const DEFAULT_SKIN: Skin = 'minimal'

interface ThemeContextValue {
  mode: ThemeMode
  resolved: 'light' | 'dark'
  setMode: (mode: ThemeMode) => void
  skin: Skin
  setSkin: (skin: Skin) => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

function resolvePreferred(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

function applyTheme(mode: 'light' | 'dark') {
  const root = document.documentElement
  root.dataset.theme = mode
  if (mode === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

function applySkin(skin: Skin) {
  document.documentElement.dataset.skin = skin
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = usePersistentState<ThemeMode>(
    storageKeys.themeMode,
    'system',
    {
      serialize: (value) => value,
      deserialize: (raw) => (raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system')
    }
  )

  const [skin, setSkin] = usePersistentState<Skin>(storageKeys.skin, DEFAULT_SKIN, {
    serialize: (value) => value,
    deserialize: (raw) => ((SKINS as readonly string[]).includes(raw) ? (raw as Skin) : DEFAULT_SKIN)
  })

  const resolved = useMemo(() => (typeof window !== 'undefined' ? resolvePreferred(mode) : 'light'), [mode])

  // Apply synchronously during render (parent renders before children) so
  // descendants reading CSS variables — e.g. useChartTheme — always see the
  // current theme. The effects below repeat it for external/system flips.
  if (typeof window !== 'undefined') {
    applyTheme(resolved)
    applySkin(skin)
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (event: MediaQueryListEvent) => {
      if (mode === 'system') {
        applyTheme(event.matches ? 'dark' : 'light')
      }
    }
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [mode])

  useEffect(() => {
    if (typeof window === 'undefined') return
    applyTheme(resolved)
  }, [resolved])

  useEffect(() => {
    if (typeof window === 'undefined') return
    applySkin(skin)
  }, [skin])

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolved,
      setMode,
      skin,
      setSkin
    }),
    [mode, resolved, setMode, skin, setSkin]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return context
}
