import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { LifeBuoy, RefreshCw, ServerCog, Sparkles } from 'lucide-react'
import { PageToolbar } from '@/components/PageToolbar'
import { PageSection } from '@/components/PageSection'
import { PageLoadingState, PageState } from '@/components/PageState'
import { useAppMutation } from '@/hooks/useAppMutation'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useToast } from '@/providers/ToastProvider'
import { requestJson, type ApiError } from '@/services/api'
import { queryKeys } from '@/services/queryKeys'
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
      { label: t('about.app.labels.version'), value: <span data-visual-volatile="true" className="font-mono text-foreground">v{appVersion}</span> },
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
      <PageToolbar
        actions={
          <Button onClick={() => versionCheckMutation.mutate()} disabled={versionCheckMutation.isPending} size="sm">
            <Sparkles className={`mr-2 h-4 w-4${versionCheckMutation.isPending ? ' animate-spin' : ''}`} aria-hidden="true" />
            {versionCheckMutation.isPending ? t('about.support.actions.checkingUpdates') : t('about.support.actions.checkUpdates')}
          </Button>
        }
      />

      {/* The one fact no grid below carries: the address a client should be
          pointed at. Host, port, runtime and platform each have their own
          labelled cell in the grids, so repeating them here as pills would
          only make the same number appear twice on one screen. */}
      <Card className="overflow-hidden">
        <CardContent className="space-y-4 p-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {t('about.gateway.address')}
            </p>
            <p data-visual-volatile="true" className="metric-number mt-1 truncate text-4xl font-semibold tracking-tight text-foreground">
              http://{statusQuery.data?.host ?? '127.0.0.1'}:{statusQuery.data?.port ?? '-'}
            </p>
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
        </CardContent>
      </Card>

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
            <span className="block text-sm font-medium text-foreground">{t('about.support.subtitle')}</span>
            <span>{t('about.support.description')}</span>
          </span>
        }
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-4 rounded-lg bg-secondary p-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-background text-foreground">
              <LifeBuoy className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">{t('about.support.tip')}</p>
          </div>
          <code className="inline-flex self-start rounded-lg bg-secondary px-3 py-2 text-xs font-medium">
            ~/.cc-gw/config.json
          </code>
        </div>
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
        <Card key={item.label} className="rounded-xl border border-border bg-secondary shadow-none">
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

function cnSpin(spinning: boolean) {
  return `mr-2 h-4 w-4${spinning ? ' animate-spin' : ''}`
}
