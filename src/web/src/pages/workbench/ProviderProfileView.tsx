import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useAppMutation } from '@/hooks/useAppMutation'
import { useToast } from '@/providers/ToastProvider'
import { copyToClipboard } from '@/utils/clipboard'
import { balanceApi } from '@/services/providers'
import { queryKeys } from '@/services/queryKeys'
import { cn } from '@/lib/utils'
import type { ProviderConfig, ProviderEndpointProtocol } from '@/types/providers'
import { describeAuthMode, providerTypeLabel } from './ProviderDrawerSteps'

const ENDPOINT_PROTOCOL_SHORT: Record<ProviderEndpointProtocol, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI Chat',
  'openai-responses': 'Responses'
}

/** One definition row: muted label left, value right. */
function ProfileRow({
  label,
  children
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[110px_minmax(0,1fr)] sm:gap-3 sm:py-1.5">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-xs text-foreground">{children}</dd>
    </div>
  )
}

/** Mono value with a transient copy button. */
function CopyableValue({ value }: { value: string }) {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      // Shared helper: falls back to execCommand outside secure contexts, where
      // `navigator.clipboard` is undefined (console opened over LAN HTTP).
      await copyToClipboard(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      pushToast({ title: t('common.actions.copyFailed'), variant: 'error' })
    }
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate font-mono">{value}</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 w-6 shrink-0 px-0 text-muted-foreground hover:text-foreground"
        onClick={() => void copy()}
        aria-label={t('providers.profile.copy')}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-foreground" aria-hidden="true" />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </Button>
    </span>
  )
}

/**
 * Read-only provider profile — the panel's default state. Answers "这个提供商
 * 是什么" at a glance: connection surfaces, auth, models. All editing lives
 * behind the panel's explicit edit mode.
 */
export function ProviderProfileView({ provider }: { provider: ProviderConfig }) {
  const { t } = useTranslation()
  const isAggregate = provider.type === 'aggregate'

  const activeKey = useMemo(() => {
    if (!provider.keys || provider.keys.length === 0) return null
    return provider.keys.find((key) => key.active) ?? provider.keys[0]
  }, [provider.keys])

  const keyState = activeKey
    ? t('providers.profile.namedKeys', {
        count: provider.keys?.length ?? 0,
        id: activeKey.label || activeKey.id
      })
    : provider.apiKey
      ? t('providers.profile.singleKey')
      : t('providers.profile.noKey')

  const advancedFlags = useMemo(() => {
    const flags: string[] = []
    if (provider.nonStreamViaStream) flags.push(t('providers.drawer.fields.nonStreamViaStream'))
    if (provider.useAbsoluteUrl) flags.push(t('providers.drawer.fields.useAbsoluteUrl'))
    if (provider.streamUsage) flags.push(t('providers.drawer.fields.streamUsage'))
    if (provider.rpmLimit) flags.push(`RPM ${provider.rpmLimit}`)
    if (provider.rpmMaxWaitSeconds) flags.push(t('providers.profile.rpmWait', { seconds: provider.rpmMaxWaitSeconds }))
    const headerCount = Object.keys(provider.extraHeaders ?? {}).length
    if (headerCount > 0) flags.push(t('providers.profile.headers', { count: headerCount }))
    return flags
  }, [provider, t])

  const balancesQuery = useApiQuery<{ balances: Array<{ providerId: string; display?: string; fetchedAt: number }> }>(
    queryKeys.providers.balances(),
    { url: '/api/providers/balances', method: 'GET' },
    { retry: false, enabled: Boolean(provider.balanceAdapter) }
  )
  const snapshot = useMemo(
    () => balancesQuery.data?.balances.find((item) => item.providerId === provider.id) ?? null,
    [balancesQuery.data, provider.id]
  )
  const refreshBalance = useAppMutation({
    mutationFn: () => balanceApi.refresh(provider.id),
    successToast: (data) => ({
      title: t('providers.balance.refreshSuccess'),
      description: data.display ?? t('providers.balance.displayEmpty')
    }),
    errorToast: (error) => ({
      title: t('providers.balance.refreshFailure', { message: error.message })
    }),
    invalidateKeys: [queryKeys.providers.balances()]
  })

  const models = provider.models ?? []
  const defaultModel = provider.defaultModel

  return (
    <div className="space-y-5" data-testid="provider-profile-view">
      {/* Connection */}
      <section aria-labelledby="provider-profile-connection" className="space-y-2">
        <h3 id="provider-profile-connection" className="text-sm font-semibold">
          {t('providers.profile.connection')}
        </h3>
        {isAggregate ? (
          <p className="border border-border bg-secondary/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            {t('providers.aggregate.drawer.explainerBody')}
          </p>
        ) : (
          <dl className="divide-y divide-border border border-border px-3 py-1.5">
            <ProfileRow label={t('providers.profile.primaryEndpoint')}>
              {provider.baseUrl ? <CopyableValue value={provider.baseUrl} /> : <span className="text-muted-foreground">—</span>}
            </ProfileRow>
            {(provider.endpoints ?? []).map((endpoint) => (
              <ProfileRow key={endpoint.id} label={t('providers.profile.protocolEndpoint')}>
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {ENDPOINT_PROTOCOL_SHORT[endpoint.protocol]}
                  </Badge>
                  <CopyableValue value={endpoint.baseUrl} />
                </span>
              </ProfileRow>
            ))}
            <ProfileRow label={t('providers.drawer.sections.auth')}>
              <span className="flex flex-wrap items-center gap-2">
                <span>{describeAuthMode(provider.type, provider.authMode ?? 'apiKey', t)}</span>
                <span className="text-muted-foreground">·</span>
                <span className={cn(activeKey || provider.apiKey ? 'text-foreground' : 'text-warning')}>
                  {keyState}
                </span>
              </span>
            </ProfileRow>
            {provider.balanceAdapter ? (
              <ProfileRow label={t('providers.balance.title')}>
                <span className="flex flex-wrap items-center gap-2">
                  <span>{provider.balanceAdapter}</span>
                  {snapshot?.display ? (
                    <>
                      <span className="text-muted-foreground">·</span>
                      <span className="font-medium">{snapshot.display}</span>
                    </>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 bg-card px-2 text-[11px]"
                    onClick={() => refreshBalance.mutate()}
                    disabled={refreshBalance.isPending}
                  >
                    {refreshBalance.isPending ? t('common.loading') : t('providers.balance.refresh')}
                  </Button>
                </span>
              </ProfileRow>
            ) : null}
          </dl>
        )}
        {advancedFlags.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t('providers.profile.advanced')}
            </span>
            {advancedFlags.map((flag) => (
              <Badge key={flag} variant="secondary" className="text-[10px] font-normal">
                {flag}
              </Badge>
            ))}
          </div>
        ) : null}
      </section>

      {/* Models */}
      <section aria-labelledby="provider-profile-models" className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 id="provider-profile-models" className="text-sm font-semibold">
            {models.length > 0
              ? `${t('providers.drawer.fields.models')} (${models.length})`
              : t('providers.drawer.fields.models')}
          </h3>
          {!isAggregate ? (
            <span className="text-[11px] text-muted-foreground">
              {t('providers.profile.defaultIs', { model: defaultModel ?? t('providers.card.noDefault') })}
            </span>
          ) : null}
        </div>
        {models.length === 0 ? (
          <p className="border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
            {t('providers.profile.noModelsHint')}
          </p>
        ) : isAggregate ? (
          <ul className="divide-y divide-border border border-border">
            {models.map((model) => (
              <li key={model.id} className="px-3 py-2">
                <p className="font-mono text-xs">{model.id}</p>
                {model.members && model.members.length > 0 ? (
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" title={model.members.map((m) => m.target).join(' → ')}>
                    {model.members.map((m) => m.target).join(' → ')}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {models.map((model) => {
              const isDefault = model.id === defaultModel
              return (
                <div
                  key={model.id}
                  className={cn(
                    'flex min-w-0 items-center gap-2 border px-2.5 py-1.5',
                    isDefault ? 'border-foreground/60 bg-secondary/60' : 'border-border bg-secondary/30'
                  )}
                  title={model.label ? `${model.label} (${model.id})` : model.id}
                >
                  <span
                    className={cn('h-1.5 w-1.5 shrink-0 rounded-full', isDefault ? 'bg-foreground' : 'bg-border')}
                    aria-hidden="true"
                  />
                  <span className="truncate font-mono text-xs">{model.id}</span>
                  {isDefault ? (
                    <span className="ml-auto shrink-0 text-[10px] font-medium text-foreground">
                      {t('providers.profile.defaultTag')}
                    </span>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Provider type footnote — vendor identity for preset-created providers. */}
      {!isAggregate && provider.type && provider.type !== 'openai' && provider.type !== 'anthropic' ? (
        <p className="text-[11px] text-muted-foreground">
          {t('providers.profile.typeFootnote', { type: providerTypeLabel(provider.type, t) })}
        </p>
      ) : null}
    </div>
  )
}
