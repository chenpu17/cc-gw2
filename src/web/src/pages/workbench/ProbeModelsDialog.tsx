import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AppDialogBody,
  AppDialogContent,
  AppDialogFooter,
  AppDialogHeader
} from '@/components/DialogShell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useToast } from '@/providers/ToastProvider'
import { toApiError } from '@/services/api'
import { modelManagementApi, type ProbedModel } from '@/services/modelManagement'
import type { ProviderConfig } from '@/types/providers'
import { cn } from '@/lib/utils'

type ProbeState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string; status?: number }
  | { phase: 'ready'; models: ProbedModel[] }

export function ProbeModelsDialog({
  open,
  providerId,
  providerName,
  existingModelIds,
  draft,
  onImport,
  onClose
}: {
  open: boolean
  providerId: string
  providerName: string
  /** model IDs already in the form — shown disabled and excluded from import */
  existingModelIds: string[]
  /** unsaved form draft; when present the backend probes it directly */
  draft?: ProviderConfig
  onImport: (models: ProbedModel[]) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const [state, setState] = useState<ProbeState>({ phase: 'loading' })
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // serialize() returns a fresh object each render — keep it in a ref so the
  // probe effect only re-fires when the dialog actually opens.
  const draftRef = useRef(draft)
  draftRef.current = draft

  useEffect(() => {
    if (!open) return undefined
    setState({ phase: 'loading' })
    setSearch('')
    setSelected(new Set())
    let cancelled = false
    modelManagementApi
      .probeModels(providerId, draftRef.current)
      .then((response) => {
        if (cancelled) return
        if (response.ok && response.models) {
          setState({ phase: 'ready', models: response.models })
        } else {
          setState({
            phase: 'error',
            message: response.statusText?.trim() || t('providers.drawer.probe.failedFallback'),
            status: response.status > 0 ? response.status : undefined
          })
        }
      })
      .catch((error) => {
        if (cancelled) return
        setState({ phase: 'error', message: toApiError(error).message })
      })
    return () => {
      cancelled = true
    }
  }, [open, providerId, t])

  const existingIds = useMemo(() => new Set(existingModelIds), [existingModelIds])

  const filteredModels = useMemo(() => {
    if (state.phase !== 'ready') return []
    const keyword = search.trim().toLowerCase()
    if (!keyword) return state.models
    return state.models.filter(
      (model) =>
        model.id.toLowerCase().includes(keyword) ||
        (model.label ?? '').toLowerCase().includes(keyword)
    )
  }, [state, search])

  const selectableFilteredIds = useMemo(
    () => filteredModels.map((model) => model.id).filter((id) => !existingIds.has(id)),
    [filteredModels, existingIds]
  )

  const toggleModel = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleSelectAllFiltered = () => {
    setSelected((prev) => new Set([...prev, ...selectableFilteredIds]))
  }

  const handleClear = () => {
    setSelected(new Set())
  }

  const handleImport = () => {
    if (state.phase !== 'ready' || selected.size === 0) return
    const models = state.models.filter((model) => selected.has(model.id))
    onImport(models)
    pushToast({
      title: t('providers.drawer.probe.importSuccess', { count: models.length }),
      variant: 'success'
    })
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <AppDialogContent className="max-w-2xl">
        <AppDialogHeader>
          <DialogTitle>{t('providers.drawer.probe.title')}</DialogTitle>
          <DialogDescription>
            {t('providers.drawer.probe.subtitle', { name: providerName })}
          </DialogDescription>
        </AppDialogHeader>
        <AppDialogBody className="space-y-4">
          {state.phase === 'loading' ? (
            <p className="rounded-xl bg-secondary/50 px-4 py-6 text-center text-sm text-muted-foreground">
              {t('providers.drawer.probe.loading')}
            </p>
          ) : null}

          {state.phase === 'error' ? (
            <div className="space-y-2 rounded-xl border border-warning/30 bg-warning-bg p-4">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-warning">
                  {t('providers.drawer.probe.failedTitle')}
                </p>
                {state.status ? (
                  <Badge variant="warning" className="shrink-0">
                    HTTP {state.status}
                  </Badge>
                ) : null}
              </div>
              <p className="break-words text-xs leading-relaxed text-warning">{state.message}</p>
              <p className="text-xs text-muted-foreground">
                {t('providers.drawer.probe.failedHint')}
              </p>
            </div>
          ) : null}

          {state.phase === 'ready' ? (
            <>
              <div className="flex items-center gap-3">
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('providers.drawer.probe.searchPlaceholder')}
                  className="h-9"
                />
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t('providers.drawer.probe.totalCount', { count: state.models.length })}
                </span>
              </div>

              <div className="flex items-center justify-between gap-3 text-xs">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-auto bg-card px-2 py-1 text-xs"
                    onClick={handleSelectAllFiltered}
                    disabled={selectableFilteredIds.length === 0}
                  >
                    {t('providers.drawer.probe.selectAll')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-auto bg-card px-2 py-1 text-xs"
                    onClick={handleClear}
                    disabled={selected.size === 0}
                  >
                    {t('providers.drawer.probe.clearSelection')}
                  </Button>
                </div>
                <span className="text-muted-foreground">
                  {t('providers.drawer.probe.selectedCount', { count: selected.size })}
                </span>
              </div>

              {filteredModels.length === 0 ? (
                <p className="rounded-xl bg-secondary/50 px-4 py-6 text-center text-sm text-muted-foreground">
                  {t('providers.drawer.probe.emptyResult')}
                </p>
              ) : (
                <div className="grid max-h-80 gap-1 overflow-y-auto">
                  {filteredModels.map((model) => {
                    const imported = existingIds.has(model.id)
                    const checked = selected.has(model.id)
                    return (
                      <label
                        key={model.id}
                        className={cn(
                          'flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors',
                          imported
                            ? 'cursor-not-allowed opacity-60'
                            : 'cursor-pointer hover:border-primary/20 hover:bg-accent/50',
                          checked && 'border-primary/30 bg-primary/10'
                        )}
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 rounded border-input accent-primary"
                          checked={checked}
                          disabled={imported}
                          onChange={() => toggleModel(model.id)}
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">{model.id}</span>
                        {model.label ? (
                          <span className="shrink-0 truncate text-xs text-muted-foreground">
                            {model.label}
                          </span>
                        ) : null}
                        {imported ? (
                          <Badge variant="secondary" className="shrink-0">
                            {t('providers.drawer.probe.imported')}
                          </Badge>
                        ) : null}
                      </label>
                    )
                  })}
                </div>
              )}
            </>
          ) : null}
        </AppDialogBody>
        <AppDialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.actions.cancel')}
          </Button>
          <Button onClick={handleImport} disabled={state.phase !== 'ready' || selected.size === 0}>
            {t('providers.drawer.probe.importAction', { count: selected.size })}
          </Button>
        </AppDialogFooter>
      </AppDialogContent>
    </Dialog>
  )
}
