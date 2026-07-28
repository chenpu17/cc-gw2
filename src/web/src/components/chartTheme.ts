import { useMemo } from 'react'
import { useTheme } from '@/providers/ThemeProvider'

/** Read a CSS custom property as a raw value (hex string under Modernist). */
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
 * variables in global.css so charts follow light/dark automatically; the
 * hook recomputes when the resolved theme flips. Modernist stores hex values
 * directly (no hsl() channel wrapping), so cssVar returns them as-is.
 */
export function useChartTheme(): ChartTheme {
  const { resolved } = useTheme()

  return useMemo(() => {
    // resolved is the dependency that triggers a re-read after the theme class flips
    void resolved
    const foreground = cssVar('--foreground', '#201e1d')
    const muted = cssVar('--muted-foreground', '#605d5d')
    const border = cssVar('--border', '#d7d3d3')
    const card = cssVar('--card', '#ffffff')

    return {
      palette: [
        cssVar('--chart-1', '#ec3013'),
        cssVar('--chart-2', '#ae1800'),
        cssVar('--chart-3', '#ff9783'),
        cssVar('--chart-4', '#444141'),
        cssVar('--chart-5', '#9b9797')
      ],
      success: cssVar('--success', '#444141'),
      warning: cssVar('--warning', '#ae1800'),
      error: cssVar('--error', '#dd2b0f'),
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
  }, [resolved])
}
