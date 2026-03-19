import React from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export function SectionIntro({
  eyebrow,
  title,
  description,
  breadcrumb,
  aside
}: {
  eyebrow: string
  title: string
  description: string
  breadcrumb: string[]
  aside?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <span>{eyebrow}</span>
          {breadcrumb.map((item, index) => (
            <React.Fragment key={`${item}-${index}`}>
              {index > 0 ? <ChevronRight className="h-3.5 w-3.5" /> : null}
              <span className={cn(index === breadcrumb.length - 1 && 'text-foreground')}>{item}</span>
            </React.Fragment>
          ))}
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.03em] text-foreground">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {aside ? <div className="w-full shrink-0 lg:w-auto">{aside}</div> : null}
    </div>
  )
}
