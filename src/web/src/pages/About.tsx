import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  Copy,
  LifeBuoy,
  Loader2,
  RefreshCw,
  ServerCog,
  Sparkles,
  XCircle
} from 'lucide-react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  AppDialogBody,
  AppDialogContent,
  AppDialogFooter,
  AppDialogHeader
} from '@/components/DialogShell'
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
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { copyToClipboard } from '@/utils/clipboard'
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
  upgradeMode: 'auto' | 'manual' | 'unsupported'
  upgradeReason?: string | null
  installMethod?: string | null
  manualCommand: string
}

interface UpgradeStateFile {
  id?: string
  phase?: string
  fromVersion?: string
  toVersion?: string
  startedAt?: number
  updatedAt?: number
  finishedAt?: number | null
  error?: string | null
  rolledBack?: boolean
  platform?: string | null
  installMethod?: string | null
  logPath?: string | null
}

interface UpgradeStatusResponse {
  phase: string
  stale: boolean
  state?: UpgradeStateFile | null
  upgradeMode: 'auto' | 'manual' | 'unsupported'
  upgradeReason?: string | null
  installMethod?: string | null
  manualCommand: string
  currentVersion: string
  platform: string
  activeRequests: number
}

interface UpgradeStartResponse {
  id: string
  phase: string
  fromVersion: string
  toVersion: string
}

const ACTIVE_UPGRADE_PHASES = ['preparing', 'installing', 'draining', 'starting', 'verifying']
const UPGRADE_MARKER_KEY = 'cc-gw-upgrade-pending'

interface UpgradeMarker {
  id?: string
  startedAt: number
}

function isActiveUpgradePhase(phase?: string | null): boolean {
  return Boolean(phase && ACTIVE_UPGRADE_PHASES.includes(phase))
}

function isTerminalUpgradePhase(phase?: string | null): boolean {
  return phase === 'succeeded' || phase === 'failed'
}

/**
 * A reload during the restart window loses all in-memory query state, and the
 * server is unreachable exactly then. Persist a small marker so a fresh page
 * can keep polling until the helper reports a terminal phase.
 */
function readUpgradeMarker(): UpgradeMarker | null {
  try {
    const raw = window.localStorage.getItem(UPGRADE_MARKER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as UpgradeMarker
    return typeof parsed?.startedAt === 'number' ? parsed : null
  } catch {
    return null
  }
}

function writeUpgradeMarker(marker: UpgradeMarker | null): void {
  try {
    if (marker) {
      window.localStorage.setItem(UPGRADE_MARKER_KEY, JSON.stringify(marker))
    } else {
      window.localStorage.removeItem(UPGRADE_MARKER_KEY)
    }
  } catch {}
}

export default function AboutPage() {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const [versionCheck, setVersionCheck] = useState<VersionCheckResponse | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [progressOpen, setProgressOpen] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [started, setStarted] = useState<UpgradeStartResponse | null>(null)
  const [progressDismissed, setProgressDismissed] = useState(false)
  const [upgradeMarker, setUpgradeMarker] = useState<UpgradeMarker | null>(() => readUpgradeMarker())
  const lastPhaseRef = useRef<string | null>(null)
  const autoResumedRunRef = useRef<string | null>(null)

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

  const upgradeStatusQuery = useApiQuery<UpgradeStatusResponse, ApiError>(
    queryKeys.upgrade.status(),
    { url: '/api/version/upgrade/status', method: 'GET' },
    {
      staleTime: 0,
      retry: false,
      refetchOnWindowFocus: false,
      refetchInterval: (query) => {
        const data = query.state.data
        // Terminal states never change again; keep polling only while something
        // is actually moving (or the page is waiting to discover the outcome).
        if (data?.stale || isTerminalUpgradePhase(data?.phase)) {
          return false
        }
        if (isActiveUpgradePhase(data?.phase)) {
          return 1000
        }
        if (upgradeMarker) {
          return 2000
        }
        return confirmOpen || progressOpen ? 1000 : false
      }
    }
  )

  const upgradePhase = upgradeStatusQuery.data?.phase
  const statusStateId = upgradeStatusQuery.data?.state?.id
  const upgradeInProgress =
    isActiveUpgradePhase(upgradePhase) && !upgradeStatusQuery.data?.stale

  // Resume the progress dialog after a reload while the helper is still busy.
  // A dismissal must stick: the user explicitly chose to keep it in the background.
  useEffect(() => {
    if (!upgradeInProgress || progressDismissed) {
      return
    }
    const runId = statusStateId ?? upgradeMarker?.id ?? 'active'
    if (autoResumedRunRef.current === runId) {
      return
    }
    autoResumedRunRef.current = runId
    setProgressOpen(true)
  }, [upgradeInProgress, progressDismissed, statusStateId, upgradeMarker?.id])

  // A persisted marker survives page reloads (and a 401 re-login) so the page
  // keeps polling and shows the final outcome instead of silently forgetting it.
  useEffect(() => {
    if (!upgradeMarker) {
      return
    }
    if (Date.now() - upgradeMarker.startedAt > 60 * 60 * 1000) {
      writeUpgradeMarker(null)
      setUpgradeMarker(null)
      return
    }
    const phase = upgradeStatusQuery.data?.phase
    if (!phase) {
      return
    }
    if (statusStateId && upgradeMarker.id && statusStateId !== upgradeMarker.id) {
      // Another upgrade owns the state file; this page has nothing to wait for.
      writeUpgradeMarker(null)
      setUpgradeMarker(null)
      return
    }
    if (!progressDismissed) {
      autoResumedRunRef.current = statusStateId ?? upgradeMarker.id ?? 'active'
      setProgressOpen(true)
    }
    if (isTerminalUpgradePhase(phase) || upgradeStatusQuery.data?.stale) {
      writeUpgradeMarker(null)
      setUpgradeMarker(null)
    }
  }, [
    progressDismissed,
    statusStateId,
    upgradeMarker,
    upgradeStatusQuery.data?.phase,
    upgradeStatusQuery.data?.stale
  ])

  // Surface the outcome even when the user closed the dialog mid-flight.
  useEffect(() => {
    const phase = upgradeStatusQuery.data?.phase ?? null
    const state = upgradeStatusQuery.data?.state
    // Ignore a previous run's terminal state until the new run's state lands.
    if (started && state?.id && state.id !== started.id) {
      return
    }
    if (!phase || phase === lastPhaseRef.current) {
      return
    }
    const previous = lastPhaseRef.current
    lastPhaseRef.current = phase
    if (!previous || !isActiveUpgradePhase(previous)) {
      return
    }
    if (phase === 'succeeded') {
      pushToast({
        title: t('about.upgrade.progress.success', { version: state?.toVersion ?? '' }),
        description: t('about.upgrade.progress.successHint'),
        variant: 'success'
      })
    } else if (phase === 'failed') {
      pushToast({
        title: t('about.upgrade.progress.failedPhase'),
        description: state?.error ?? t('about.upgrade.progress.failedHint'),
        variant: 'error'
      })
    }
  }, [pushToast, started, t, upgradeStatusQuery.data?.phase, upgradeStatusQuery.data?.state])

  const versionCheckMutation = useAppMutation<VersionCheckResponse, void>({
    mutationFn: async () => requestJson<VersionCheckResponse>({ url: '/api/version/check', method: 'GET' }),
    successToast: (data) => {
      if (data.updateAvailable) {
        return {
          title: t('about.toast.updateAvailable.title', { version: data.latestVersion }),
          description:
            data.upgradeMode === 'auto'
              ? t('about.toast.updateAvailable.descriptionAuto', {
                  packageName: data.packageName
                })
              : t('about.toast.updateAvailable.description', {
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

  const upgradeMutation = useAppMutation<UpgradeStartResponse, void>({
    mutationFn: async () =>
      requestJson<UpgradeStartResponse>({ url: '/api/version/upgrade', method: 'POST' }),
    onSuccess: (data) => {
      setStarted(data)
      lastPhaseRef.current = null
      autoResumedRunRef.current = data.id
      setProgressDismissed(false)
      const marker = { id: data.id, startedAt: Date.now() }
      writeUpgradeMarker(marker)
      setUpgradeMarker(marker)
      setConfirmOpen(false)
      setAcknowledged(false)
      setProgressOpen(true)
      void upgradeStatusQuery.refetch()
    },
    errorToast: (error) => ({
      title: t('about.upgrade.toast.startFailed'),
      description: error.message
    })
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

  const activeUpgrade = upgradeStatusQuery.data
  // The state file keeps the last run's result forever. Once this page has
  // started a run, only trust status data that belongs to that run; otherwise
  // an old succeeded/toVersion payload leaks into the new confirmation flow.
  const statusRunMatchesStarted =
    !started || !activeUpgrade?.state?.id || activeUpgrade.state.id === started.id
  const upgradeState = statusRunMatchesStarted ? (activeUpgrade?.state ?? null) : null
  const phase =
    (statusRunMatchesStarted ? activeUpgrade?.phase : null) ?? started?.phase ?? 'preparing'
  const fromVersion = upgradeState?.fromVersion ?? started?.fromVersion ?? versionCheck?.currentVersion
  const toVersion = upgradeState?.toVersion ?? started?.toVersion ?? versionCheck?.latestVersion
  const confirmTarget = versionCheck?.latestVersion ?? started?.toVersion ?? ''
  const activeRequests = activeUpgrade?.activeRequests ?? statusQuery.data?.activeRequests ?? 0
  const upgradeSucceeded = phase === 'succeeded'
  const upgradeFailed = phase === 'failed'
  const authLost = upgradeStatusQuery.isError && upgradeStatusQuery.error?.status === 401
  const reconnecting =
    progressOpen &&
    !upgradeSucceeded &&
    !upgradeFailed &&
    !authLost &&
    (upgradeStatusQuery.isError || upgradeMutation.isSuccess && !activeUpgrade)
  const manualCommand = versionCheck?.manualCommand ?? activeUpgrade?.manualCommand ?? ''
  const upgradeStale = Boolean(statusRunMatchesStarted && activeUpgrade?.stale)
  const phaseKey = ACTIVE_UPGRADE_PHASES.includes(phase) ? phase : 'preparing'

  const openConfirm = () => {
    setAcknowledged(false)
    setConfirmOpen(true)
    void upgradeStatusQuery.refetch()
  }

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
            versionCheck.updateAvailable ? (
              <div className="rounded-xl border border-warning/30 bg-warning-bg px-4 py-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">
                      {t('about.update.available', { version: versionCheck.latestVersion })}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {t('about.update.channel', { channel: versionCheck.channel })}
                      {versionCheck.publishedAt ? ` · ${new Date(versionCheck.publishedAt).toLocaleString()}` : ''}
                    </p>
                  </div>
                  {upgradeInProgress ? (
                    <Button size="sm" variant="outline" onClick={() => setProgressOpen(true)}>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                      {t('about.upgrade.viewProgress')}
                    </Button>
                  ) : versionCheck.upgradeMode === 'auto' ? (
                    <Button size="sm" onClick={openConfirm}>
                      <ArrowUpCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                      {t('about.upgrade.action')}
                    </Button>
                  ) : null}
                </div>
                {versionCheck.upgradeMode === 'auto' ? (
                  <p className="mt-3 text-muted-foreground">{t('about.upgrade.autoHint')}</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    <p className="text-muted-foreground">
                      {t('about.upgrade.manualHint')}
                      {versionCheck.upgradeReason
                        ? ` ${t(`about.upgrade.reason.${versionCheck.upgradeReason}`)}`
                        : ''}
                    </p>
                    <CommandCopy command={versionCheck.manualCommand} />
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg bg-secondary px-4 py-3 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">
                  {t('about.update.current', { version: versionCheck.currentVersion })}
                </p>
                <p className="mt-1">
                  {t('about.update.channel', { channel: versionCheck.channel })}
                  {versionCheck.publishedAt ? ` · ${new Date(versionCheck.publishedAt).toLocaleString()}` : ''}
                </p>
              </div>
            )
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

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open)
          if (!open) {
            setAcknowledged(false)
          }
        }}
        title={t('about.upgrade.confirm.title', { version: confirmTarget ?? '' })}
        description={t('about.upgrade.confirm.description')}
        confirmLabel={
          upgradeMutation.isPending
            ? t('about.upgrade.confirm.starting')
            : t('about.upgrade.confirm.confirm')
        }
        cancelLabel={t('about.upgrade.confirm.cancel')}
        onConfirm={() => upgradeMutation.mutate()}
        loading={upgradeMutation.isPending}
        confirmDisabled={!acknowledged}
      >
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <p className="font-medium">{t('about.upgrade.confirm.warning')}</p>
          </div>
          <div className="rounded-lg bg-secondary px-4 py-3">
            <p className="font-medium text-foreground">
              {t('about.upgrade.confirm.activeRequests', { count: activeRequests })}
            </p>
            <p className="mt-1 text-xs">{t('about.upgrade.confirm.activeHint')}</p>
          </div>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:border-foreground/30 hover:bg-accent/50">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input accent-foreground"
            />
            <span className="font-medium text-foreground">{t('about.upgrade.confirm.ack')}</span>
          </label>
        </div>
      </ConfirmDialog>

      <Dialog
        open={progressOpen}
        onOpenChange={(open) => {
          setProgressOpen(open)
          if (!open) {
            setProgressDismissed(true)
          }
        }}
      >
        <AppDialogContent className="max-w-lg">
          <AppDialogHeader>
            <DialogTitle>{t('about.upgrade.progress.title')}</DialogTitle>
            <DialogDescription>{t('about.upgrade.progress.description')}</DialogDescription>
          </AppDialogHeader>
          <AppDialogBody className="space-y-4 text-sm" role="status" aria-live="polite">
            {fromVersion && toVersion ? (
              <p className="font-mono text-xs text-muted-foreground">
                {t('about.upgrade.progress.fromTo', { from: fromVersion, to: toVersion })}
              </p>
            ) : null}

            {authLost ? (
              <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info-bg px-4 py-3">
                <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
                <p className="text-foreground">{t('about.upgrade.progress.authRequired')}</p>
              </div>
            ) : reconnecting && !upgradeFailed ? (
              <div className="flex items-start gap-3 rounded-xl border border-border bg-secondary px-4 py-3">
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
                <div>
                  <p className="font-medium text-foreground">{t('about.upgrade.progress.reconnecting')}</p>
                  <p className="mt-1 text-muted-foreground">{t('about.upgrade.progress.reconnectingHint')}</p>
                </div>
              </div>
            ) : null}

            {upgradeSucceeded ? (
              <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success-bg px-4 py-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
                <div>
                  <p className="font-medium text-foreground">
                    {t('about.upgrade.progress.success', { version: toVersion ?? '' })}
                  </p>
                  <p className="mt-1 text-muted-foreground">{t('about.upgrade.progress.successHint')}</p>
                </div>
              </div>
            ) : upgradeFailed ? (
              <div className="space-y-3">
                <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3">
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
                  <div>
                    <p className="font-medium text-destructive">{t('about.upgrade.progress.failedPhase')}</p>
                    <p className="mt-1 text-foreground">
                      {upgradeState?.error ?? t('about.upgrade.progress.failedHint')}
                    </p>
                    {upgradeState?.rolledBack ? (
                      <p className="mt-1 text-muted-foreground">
                        {t('about.upgrade.progress.rolledBack', { version: fromVersion ?? '' })}
                      </p>
                    ) : null}
                  </div>
                </div>
                {upgradeState?.logPath ? (
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {t('about.upgrade.progress.logPath', { path: upgradeState.logPath })}
                    </p>
                  </div>
                ) : null}
                {manualCommand ? (
                  <div className="space-y-2">
                    <p className="text-muted-foreground">{t('about.upgrade.progress.manualHint')}</p>
                    <CommandCopy command={manualCommand} />
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-xl border border-border bg-secondary px-4 py-3">
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-foreground" aria-hidden="true" />
                <div>
                  <p className="font-medium text-foreground">
                    {t(`about.upgrade.progress.phases.${phaseKey}`, { version: toVersion ?? '' })}
                  </p>
                  {phase === 'draining' ? (
                    <p className="mt-1 text-muted-foreground">
                      {t('about.upgrade.progress.drainingHint', { count: activeRequests })}
                    </p>
                  ) : null}
                </div>
              </div>
            )}

            {upgradeStale && !upgradeSucceeded ? (
              <p className="rounded-lg bg-secondary px-4 py-3 text-muted-foreground">
                {t('about.upgrade.progress.stale')}
              </p>
            ) : null}
          </AppDialogBody>
          <AppDialogFooter>
            {upgradeSucceeded || authLost ? (
              <Button onClick={() => window.location.reload()}>
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                {t('about.upgrade.progress.reload')}
              </Button>
            ) : upgradeFailed ? (
              <>
                <Button variant="outline" onClick={() => setProgressOpen(false)}>
                  {t('about.upgrade.progress.close')}
                </Button>
                {versionCheck?.upgradeMode === 'auto' || activeUpgrade?.upgradeMode === 'auto' ? (
                  <Button
                    onClick={() => {
                      setProgressOpen(false)
                      openConfirm()
                    }}
                  >
                    {t('about.upgrade.progress.retry')}
                  </Button>
                ) : null}
              </>
            ) : (
              <Button variant="outline" onClick={() => setProgressOpen(false)}>
                {t('about.upgrade.progress.background')}
              </Button>
            )}
          </AppDialogFooter>
        </AppDialogContent>
      </Dialog>
    </div>
  )
}

function CommandCopy({ command }: { command: string }) {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await copyToClipboard(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      pushToast({ title: t('about.upgrade.copyFailed'), variant: 'error' })
    }
  }

  return (
    <div className="space-y-2">
      <code className="block overflow-x-auto rounded-lg bg-secondary px-3 py-2 font-mono text-xs text-foreground">
        {command}
      </code>
      <Button variant="outline" size="sm" onClick={() => void handleCopy()}>
        <Copy className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
        {copied ? t('about.upgrade.copied') : t('about.upgrade.copyCommand')}
      </Button>
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
