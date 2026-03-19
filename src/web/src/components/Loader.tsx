import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Loader({ label }: { label?: string }) {
  const { t } = useTranslation()

  return (
    <div className="flex h-full items-center justify-center p-12" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-[1.35rem] border border-primary/15 bg-[linear-gradient(135deg,rgba(225,93,73,0.14),rgba(217,169,64,0.08),rgba(255,255,255,0.9))] text-primary shadow-[0_20px_40px_-24px_rgba(225,93,73,0.48)]">
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
        </div>
        <p className="text-sm text-muted-foreground">{label ?? t('common.loading')}</p>
      </div>
    </div>
  )
}

export function LoadingState({ label, className }: { label?: string; className?: string }) {
  const { t } = useTranslation()

  return (
    <div className={cn('inline-flex items-center gap-3 rounded-full border border-border/70 bg-background/80 px-3.5 py-2 text-sm text-muted-foreground shadow-[0_1px_2px_rgba(15,23,42,0.03)]', className)}>
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      </span>
      <span>{label ?? t('common.loading')}</span>
    </div>
  )
}
