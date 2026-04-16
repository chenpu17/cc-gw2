import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Info, LifeBuoy, RefreshCw, ServerCog, Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { PageSection } from '@/components/PageSection'
import { PageLoadingState, PageState } from '@/components/PageState'
import { useAppMutation } from '@/hooks/useAppMutation'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useToast } from '@/providers/ToastProvider'
import { requestJson, type ApiError } from '@/services/api'
import { queryKeys } from '@/services/queryKeys'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import packageJson from '../../../../package.json' with { type: 'json' }

interface StatusResponse {
  port: number
  host?: string
  providers: number
  activeRequests?: number
  runtime?: string
  backendVersion?: string
  platform?: string
  pid?: number
}

interface InfoGridItem {
  label: string
  value: ReactNode
  hint?: ReactNode
}

interface VersionCheckResponse {
  currentVersion: string
  latestVersion: string
  channel: string
  updateAvailable: boolean
  packageName: string
  releaseUrl: string
  publishedAt?: string | null
}

export default function AboutPage() {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const [versionCheck, setVersionCheck] = useState<VersionCheckResponse | null>(null)

  const statusQuery = useApiQuery<StatusResponse, ApiError>(
    queryKeys.status.gateway(),
    { url: '/api/status', method: 'GET' },
    { staleTime: 60_000 }
  )

  useEffect(() => {
    if (statusQuery.isError && statusQuery.error) {
      pushToast({
        title: t('about.toast.statusError.title'),
        description: statusQuery.error.message,
        variant: 'error'
      })
    }
  }, [pushToast, statusQuery.error, statusQuery.isError, t])

  const versionCheckMutation = useAppMutation<VersionCheckResponse, void>({
    mutationFn: async () => requestJson<VersionCheckResponse>({ url: '/api/version/check', method: 'GET' }),
    successToast: (data) => {
      if (data.updateAvailable) {
        return {
          title: t('about.toast.updateAvailable.title', { version: data.latestVersion }),
          description: t('about.toast.updateAvailable.description', {
            packageName: data.packageName
          })
        }
      }

      return {
        title: t('about.toast.upToDate.title', { version: data.currentVersion }),
        description: t('about.toast.upToDate.description')
      }
    },
    errorToast: (error) => ({
      title: t('about.toast.updateError.title'),
      description: error.message
    }),
    onSuccess: async (data) => {
      setVersionCheck(data)
    }
  })

  const appVersion = (packageJson as { version?: string }).version ?? '0.0.0'
  const buildTime = import.meta.env.VITE_BUILD_TIME ?? '-'

  const infoItems = useMemo<InfoGridItem[]>(
    () => [
      { label: t('about.app.labels.name'), value: <span className="font-mono">cc-gw</span> },
      { label: t('about.app.labels.version'), value: <span data-visual-volatile="true" className="font-mono text-primary">v{appVersion}</span> },
      { label: t('about.app.labels.buildTime'), value: <span data-visual-volatile="true">{buildTime}</span>, hint: t('about.app.hint.buildTime') },
      { label: t('about.app.labels.runtime'), value: <span className="font-mono">{statusQuery.data?.runtime ?? 'rust'}</span> },
      { label: t('about.app.labels.backendVersion'), value: <span data-visual-volatile="true" className="font-mono">{statusQuery.data?.backendVersion ?? '-'}</span> }
    ],
    [appVersion, buildTime, statusQuery.data?.backendVersion, statusQuery.data?.runtime, t]
  )

  const runtimeItems = useMemo<InfoGridItem[]>(() => {
    if (!statusQuery.data) {
      return []
    }

    return [
      { label: t('about.status.labels.host'), value: statusQuery.data.host ?? '127.0.0.1' },
      { label: t('about.status.labels.port'), value: <span data-visual-volatile="true">{statusQuery.data.port.toLocaleString()}</span> },
      { label: t('about.status.labels.providers'), value: statusQuery.data.providers.toLocaleString() },
      {
        label: t('about.status.labels.active'),
        value: (statusQuery.data.activeRequests ?? 0).toLocaleString(),
        hint: t('about.status.hint.active')
      },
      { label: t('about.status.labels.platform'), value: statusQuery.data.platform ?? '-' },
      { label: t('about.status.labels.pid'), value: <span data-visual-volatile="true">{statusQuery.data.pid?.toLocaleString() ?? '-'}</span> }
    ]
  }, [statusQuery.data, t])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={<Info className="h-5 w-5" aria-hidden="true" />}
        title={t('about.title')}
        description={t('about.description')}
        badge={<span data-visual-volatile="true">v{appVersion}</span>}
        eyebrow="Runtime"
        breadcrumb="Gateway / About"
        helper={t('about.support.description')}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
            <div className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-muted-foreground">
              manual refresh only
            </div>
            <Button onClick={() => versionCheckMutation.mutate()} disabled={versionCheckMutation.isPending} className="w-full sm:w-auto">
              <Sparkles className={`mr-2 h-4 w-4${versionCheckMutation.isPending ? ' animate-spin' : ''}`} aria-hidden="true" />
              {versionCheckMutation.isPending ? t('about.support.actions.checkingUpdates') : t('about.support.actions.checkUpdates')}
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
        <Card className="overflow-hidden rounded-[1.25rem] border border-white/70 bg-card/95 shadow-[0_20px_50px_-42px_rgba(15,23,42,0.24)]">
          <CardContent className="p-5">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <ServerCog className="h-3.5 w-3.5" aria-hidden="true" />
                Runtime snapshot
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p data-visual-volatile="true" className="metric-number truncate text-4xl font-semibold tracking-tight text-foreground">
                  {statusQuery.data?.host ?? '127.0.0.1'}:{statusQuery.data?.port ?? '-'}
                  </p>
                  <p className="text-sm text-muted-foreground">{t('about.description')}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs sm:w-56">
                  <RuntimePill label={t('about.status.labels.providers')} value={statusQuery.data?.providers?.toLocaleString() ?? '-'} />
                  <RuntimePill label={t('about.status.labels.active')} value={(statusQuery.data?.activeRequests ?? 0).toLocaleString()} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{statusQuery.data?.runtime ?? 'rust'}</Badge>
                <Badge variant="outline">{statusQuery.data?.platform ?? '-'}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-[1.25rem] border border-white/70 bg-card/95 shadow-[0_20px_50px_-42px_rgba(15,23,42,0.24)]">
          <CardContent className="p-5">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Build</p>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p data-visual-volatile="true" className="font-mono text-xl font-semibold text-primary">v{appVersion}</p>
                <p data-visual-volatile="true" className="text-xs text-muted-foreground">{buildTime}</p>
              </div>
              {versionCheck ? (
                <div className="rounded-lg bg-secondary px-4 py-3 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">
                    {versionCheck.updateAvailable
                      ? t('about.update.available', { version: versionCheck.latestVersion })
                      : t('about.update.current', { version: versionCheck.currentVersion })}
                  </p>
                  <p className="mt-1">
                    {t('about.update.channel', { channel: versionCheck.channel })}
                    {versionCheck.publishedAt ? ` · ${new Date(versionCheck.publishedAt).toLocaleString()}` : ''}
                  </p>
                </div>
              ) : null}
              <div className="rounded-[0.95rem] bg-secondary/65 px-3.5 py-3 text-sm text-muted-foreground">
                {t('about.support.tip')}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <PageSection title={t('about.app.title')} description={t('about.app.subtitle')}>
          <InfoGrid items={infoItems} />
        </PageSection>

        <PageSection
          title={t('about.status.title')}
          description={t('about.status.subtitle')}
          actions={
            <Button variant="outline" size="sm" onClick={() => void statusQuery.refetch()} disabled={statusQuery.isFetching}>
              <RefreshCw className={cnSpin(statusQuery.isFetching)} aria-hidden="true" />
              {statusQuery.isFetching ? t('common.actions.refreshing') : t('common.actions.refresh')}
            </Button>
          }
        >
          {statusQuery.isLoading ? (
            <PageLoadingState compact label={t('about.status.loading')} />
          ) : statusQuery.isError ? (
            <PageState
              compact
              tone="danger"
              icon={<ServerCog className="h-5 w-5" aria-hidden="true" />}
              title={t('common.status.error')}
              description={statusQuery.error?.message ?? t('common.unknownError')}
              action={(
                <Button variant="outline" size="sm" onClick={() => void statusQuery.refetch()}>
                  {t('common.actions.refresh')}
                </Button>
              )}
            />
          ) : runtimeItems.length > 0 ? (
            <InfoGrid items={runtimeItems} />
          ) : (
            <PageState
              compact
              tone="primary"
              icon={<ServerCog className="h-5 w-5" aria-hidden="true" />}
              title={t('about.status.empty')}
              description={t('common.actions.refresh')}
            />
          )}
        </PageSection>
      </div>

      <PageSection
        title={t('about.support.title')}
        description={
          <span className="space-y-1">
            <span className="block text-sm font-medium text-primary">{t('about.support.subtitle')}</span>
            <span>{t('about.support.description')}</span>
          </span>
        }
      >
        <Card className="rounded-xl bg-card shadow-[var(--surface-shadow)]">
          <CardContent className="flex flex-col gap-4 pt-5 md:flex-row md:items-start md:justify-between">
            <div className="flex items-start gap-4 rounded-lg bg-secondary p-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <LifeBuoy className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="max-w-2xl text-sm text-muted-foreground">{t('about.support.tip')}</p>
            </div>
            <code className="inline-flex self-start rounded-lg bg-secondary px-3 py-2 text-xs font-medium">
              ~/.cc-gw/config.json
            </code>
          </CardContent>
        </Card>
      </PageSection>
    </div>
  )
}

function InfoGrid({ items }: { items: InfoGridItem[] }) {
  if (items.length === 0) {
    return null
  }

  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <Card key={item.label} className="rounded-[1rem] border border-white/70 bg-secondary/45 shadow-none">
          <CardContent className="p-4">
            <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</dt>
            <dd className="metric-number mt-2 text-sm font-semibold text-foreground">{item.value}</dd>
            {item.hint ? <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p> : null}
          </CardContent>
        </Card>
      ))}
    </dl>
  )
}

function RuntimePill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[0.9rem] bg-secondary/65 px-3 py-2 text-right">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="metric-number mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  )
}

function cnSpin(spinning: boolean) {
  return `mr-2 h-4 w-4${spinning ? ' animate-spin' : ''}`
}
