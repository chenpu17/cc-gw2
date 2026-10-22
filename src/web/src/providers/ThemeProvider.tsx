import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { usePersistentState } from '@/hooks/usePersistentState'
import { storageKeys } from '@/services/storageKeys'

export type ThemeMode = 'light' | 'dark' | 'system'

/** 风格家族(data-skin 轴),与明暗模式(data-theme 轴)正交。 */
export const SKINS = [
  'minimal',
  'classic',
  'paper',
  'glass',
  'modernist',
  'neon',
  'aurora',
  'sakura',
  'ocean'
] as const
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

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
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

  // System mode must live in state, not only on <html>: charts, the command
  // palette and anything else reading `resolved` would otherwise keep the old
  // value after the OS flips light/dark.
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  const resolved = useMemo<'light' | 'dark'>(
    () => (mode === 'system' ? (systemDark ? 'dark' : 'light') : mode),
    [mode, systemDark]
  )

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
    const handler = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    // Re-sync in case the OS preference changed between the initial render and
    // the listener being attached.
    setSystemDark(media.matches)
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [])

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
