import { useMemo } from 'react'
import { useTheme } from '@/providers/ThemeProvider'

function cssVar(name: string): string {
  if (typeof window === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function hsl(name: string, fallback: string): string {
  const raw = cssVar(name)
  return raw ? `hsl(${raw.split(' ').join(' ')})` : fallback
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
 * hook recomputes when the resolved theme flips.
 */
export function useChartTheme(): ChartTheme {
  const { resolved } = useTheme()

  return useMemo(() => {
    // resolved is the dependency that triggers a re-read after the theme class flips
    void resolved
    const foreground = hsl('--foreground', '#09090B')
    const muted = hsl('--muted-foreground', '#6B7280')
    const border = hsl('--border', '#E5E7EB')
    const card = hsl('--card', '#FFFFFF')

    return {
      palette: [
        hsl('--chart-1', '#4338CA'),
        hsl('--chart-2', '#15803D'),
        hsl('--chart-3', '#D97706'),
        hsl('--chart-4', '#DC2626'),
        hsl('--chart-5', '#7C3AED')
      ],
      success: hsl('--success', '#15803D'),
      warning: hsl('--warning', '#D97706'),
      error: hsl('--error', '#DC2626'),
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
