import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Disclosure } from '@/components/ui/disclosure'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useAppMutation } from '@/hooks/useAppMutation'
import { balanceApi } from '@/services/providers'
import { queryKeys } from '@/services/queryKeys'
import type { BalanceAdapterId, BalanceSnapshotsResponse } from '@/types/providers'
import { BalanceAdapterSelect } from './ProviderSurfacesSection'

/**
 * Manual balance refresh for providers with a balance adapter. Snapshots are
 * gateway runtime state: fetched on demand, lost on restart, listed by
 * `GET /api/providers/balances`. The adapter itself is part of the unsaved
 * draft — refresh stays disabled until the draft adapter is saved.
 */
export function ProviderBalanceSection({
  providerId,
  adapter,
  savedAdapter,
  onAdapterChange
}: {
  providerId: string
  /** Draft adapter from the inline edit form. */
  adapter: '' | BalanceAdapterId
  /** Adapter as currently saved in config (refresh targets this). */
  savedAdapter: BalanceAdapterId | undefined
  onAdapterChange: (value: '' | BalanceAdapterId) => void
}) {
  const { t } = useTranslation()

  const balancesQuery = useApiQuery<BalanceSnapshotsResponse>(
    queryKeys.providers.balances(),
    { url: '/api/providers/balances', method: 'GET' },
    { retry: false }
  )
  const snapshot = useMemo(
    () => balancesQuery.data?.balances.find((item) => item.providerId === providerId) ?? null,
    [balancesQuery.data, providerId]
  )

  const refreshMutation = useAppMutation({
    mutationFn: () => balanceApi.refresh(providerId),
    successToast: (data) => ({
      title: t('providers.balance.refreshSuccess'),
      description: data.display ?? t('providers.balance.displayEmpty')
    }),
    errorToast: (error) => ({
      title: t('providers.balance.refreshFailure', { message: error.message })
    }),
    invalidateKeys: [queryKeys.providers.balances()]
  })

  const adapterDirty = (adapter || undefined) !== savedAdapter

  return (
    <section className="space-y-3" aria-labelledby="provider-balance-fields">
      <div className="space-y-1">
        <h3 id="provider-balance-fields" className="text-sm font-semibold">
          {t('providers.balance.title')}
        </h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('providers.balance.hint')}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <BalanceAdapterSelect value={adapter} onChange={onAdapterChange} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="bg-card text-xs"
          onClick={() => refreshMutation.mutate()}
          disabled={!savedAdapter || adapterDirty || refreshMutation.isPending}
          title={
            !savedAdapter
              ? t('providers.balance.noAdapter')
              : adapterDirty
                ? t('providers.balance.unsavedAdapter')
                : undefined
          }
        >
          {refreshMutation.isPending
            ? t('providers.balance.refreshing')
            : t('providers.balance.refresh')}
        </Button>
        {adapterDirty && savedAdapter ? (
          <span className="text-xs text-muted-foreground">
            {t('providers.balance.unsavedAdapter')}
          </span>
        ) : null}
      </div>

      {snapshot ? (
        <div className="border border-border p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {t('providers.balance.snapshotLabel')}
          </p>
          <p className="mt-2 font-mono text-sm font-semibold tabular-nums">
            {snapshot.display ?? t('providers.balance.displayEmpty')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('providers.balance.fetchedAt', {
              time: new Date(snapshot.fetchedAt).toLocaleString()
            })}
          </p>
          <Disclosure
            summary={t('providers.balance.rawTitle')}
            className="mt-3 bg-secondary/50"
            summaryClassName="px-3 py-2 text-xs font-medium"
            contentClassName="px-3 py-3"
          >
            <pre className="max-h-64 overflow-auto font-mono text-xs leading-relaxed text-foreground">
              {JSON.stringify(snapshot.raw, null, 2)}
            </pre>
          </Disclosure>
        </div>
      ) : savedAdapter ? (
        <p className="border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          {t('providers.balance.neverRefreshed')}
        </p>
      ) : null}
    </section>
  )
}
