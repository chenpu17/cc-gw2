import { useMemo } from 'react'
import { useTheme } from '@/providers/ThemeProvider'

/** Read a CSS custom property as a raw value (hex string under every skin). */
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return raw || fallback
}

export interface ChartTheme {
  /** categorical series palette, wired to --chart-1..5 */
  palette: string[]
  /** semantic colors */
  success: string
  warning: string
  error: string
  /** muted foreground for axis labels / split lines */
  axis: string
  splitLine: string
  /** shared option fragments every chart should spread in */
  base: {
    textStyle: { color: string; fontSize: number }
    grid: { left: number; right: number; top: number; bottom: number; containLabel: boolean }
    tooltip: {
      backgroundColor: string
      borderColor: string
      textStyle: { color: string; fontSize: number }
    }
    legend: { textStyle: { color: string; fontSize: number } }
  }
}

/**
 * Single source of truth for ECharts styling. Colors are read from the CSS
 * variables in styles/themes/*.css so charts follow light/dark AND the active
 * skin family automatically; the hook recomputes when either axis flips.
 * Every skin stores opaque hex values (no hsl() channel wrapping), so cssVar
 * returns them as-is. Fallbacks below are the Minimal-light values.
 */
export function useChartTheme(): ChartTheme {
  const { resolved, skin } = useTheme()

  return useMemo(() => {
    // resolved + skin are the dependencies that trigger a re-read after either axis flips
    void resolved
    void skin
    const foreground = cssVar('--foreground', '#191a1c')
    const muted = cssVar('--muted-foreground', '#666871')
    const border = cssVar('--border', '#e4e5e8')
    const card = cssVar('--card', '#ffffff')

    return {
      palette: [
        cssVar('--chart-1', '#5e6ad2'),
        cssVar('--chart-2', '#7b84dc'),
        cssVar('--chart-3', '#b4b9ec'),
        cssVar('--chart-4', '#6b6d76'),
        cssVar('--chart-5', '#a3a5ad')
      ],
      success: cssVar('--success', '#30a46c'),
      warning: cssVar('--warning', '#ffb224'),
      error: cssVar('--error', '#e5484d'),
      axis: muted,
      splitLine: border,
      base: {
        textStyle: { color: muted, fontSize: 11 },
        grid: { left: 8, right: 8, top: 32, bottom: 4, containLabel: true },
        tooltip: {
          backgroundColor: card,
          borderColor: border,
          textStyle: { color: foreground, fontSize: 12 }
        },
        legend: { textStyle: { color: muted, fontSize: 11 } }
      }
    }
  }, [resolved, skin])
}
