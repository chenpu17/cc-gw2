import type { CSSProperties, ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { cardVariants } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { CountUp } from './count-up'

type Size = 'sm' | 'md' | 'lg'

interface Delta {
  /** signed change to render; sign drives the arrow direction */
  value: number
  /** set true when a decrease is the good outcome (e.g. latency, error rate) */
  invertColor?: boolean
  format?: (value: number) => string
}

interface SparklineConfig {
  data: number[]
  /** stroke color class, defaults to text-primary/60 */
  strokeClassName?: string
}

export interface MetricCardProps {
  label: ReactNode
  /** pre-formatted fallback value; required so SSR/snapshot always has text */
  value: ReactNode
  /** when set, value is treated as numeric and animated via CountUp */
  rawValue?: number
  format?: (value: number) => string
  suffix?: string
  icon?: ReactNode
  delta?: Delta
  sparkline?: SparklineConfig
  hint?: ReactNode
  size?: Size
  /** subtle primary wash to mark a featured tile */
  featured?: boolean
  /** solid color class for a small status dot rendered before the label */
  dotClassName?: string
  className?: string
  valueTestId?: string
  /** override the hover-elevation behaviour */
  interactive?: boolean
  style?: CSSProperties
}

const sizeStyles: Record<Size, { wrap: string; value: string; label: string; body: string }> = {
  sm: { wrap: 'p-3.5', value: 'text-xl', label: 'text-[11px]', body: 'mt-1' },
  md: { wrap: 'p-5', value: 'text-2xl', label: 'text-xs', body: 'mt-2' },
  lg: { wrap: 'p-5', value: 'text-3xl', label: 'text-xs', body: 'mt-2.5' }
}

function buildSparkline(data: number[], stroke: string): ReactNode {
  if (!data || data.length < 2) return null
  const width = 100
  const height = 28
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const stepX = width / (data.length - 1)
  const points = data.map((d, i) => {
    const x = i * stepX
    const y = height - ((d - min) / span) * (height - 4) - 2
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })
  const line = `M ${points.join(' L ')}`
  const area = `${line} L ${width},${height} L 0,${height} Z`
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
      className="h-8 w-full"
    >
      <path d={area} className="fill-primary/5" />
      <path d={line} fill="none" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={cn(stroke)} />
    </svg>
  )
}

function DeltaChip({ delta }: { delta: Delta }) {
  const positive = delta.value >= 0
  const goodIsPositive = !delta.invertColor
  const isGood = positive === goodIsPositive
  const label = delta.format ? delta.format(delta.value) : `${delta.value > 0 ? '+' : ''}${delta.value}`
  const Arrow = positive ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] font-medium',
        isGood
          ? 'bg-success-bg text-success'
          : 'bg-error-bg text-error'
      )}
    >
      <Arrow className="h-3 w-3" aria-hidden />
      {label}
    </span>
  )
}

/**
 * Unified metric/stat tile. Replaces the 5 ad-hoc stat-card implementations
 * (MonitoringCard, InsightCard, StatCard in dashboard; MetricCard,
 * InventoryStatCard in api-keys). Uses the shared cardVariants `interactive`
 * hover lift, CountUp for numeric values, and a restrained inline SVG
 * sparkline (no chart library, no tooltips).
 */
export function MetricCard({
  label,
  value,
  rawValue,
  format,
  suffix,
  icon,
  delta,
  sparkline,
  hint,
  size = 'md',
  featured = false,
  dotClassName,
  className,
  valueTestId,
  interactive = true,
  style
}: MetricCardProps) {
  const styles = sizeStyles[size]
  const renderedValue = rawValue !== undefined ? (
    <CountUp value={rawValue} format={format} />
  ) : (
    value
  )
  const stroke = sparkline?.strokeClassName ?? 'text-primary/60'

  return (
    <div
      className={cn(
        cardVariants({ variant: interactive ? 'interactive' : 'default' }),
        'motion-surface relative flex flex-col',
        styles.wrap,
        featured && 'bg-primary/[0.03]',
        className
      )}
      style={style}
    >
      <div className="flex items-center gap-2">
        {dotClassName ? (
          <span className={cn('h-[7px] w-[7px] rounded-full', dotClassName)} aria-hidden />
        ) : null}
        {icon ? (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
            {icon}
          </span>
        ) : null}
        <span className={cn('font-medium uppercase tracking-wider text-muted-foreground', styles.label)}>
          {label}
        </span>
      </div>

      <div className={cn('flex items-end gap-2', styles.body)}>
        <span
          {...(valueTestId ? { 'data-testid': valueTestId } : {})}
          className={cn('metric-number font-semibold tracking-tight text-foreground', styles.value)}
        >
          {renderedValue}
          {suffix ? <span className="ml-0.5 text-sm font-medium text-muted-foreground">{suffix}</span> : null}
        </span>
        {delta ? <DeltaChip delta={delta} /> : null}
      </div>

      {hint ? <p className="mt-1.5 text-xs text-muted-foreground/70">{hint}</p> : null}

      {sparkline ? <div className="mt-2.5">{buildSparkline(sparkline.data, stroke)}</div> : null}
    </div>
  )
}
