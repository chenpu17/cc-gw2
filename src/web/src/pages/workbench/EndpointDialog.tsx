import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { customEndpointsApi } from '@/services/api'
import { useAppMutation } from '@/hooks/useAppMutation'
import {
  AppDialogBody,
  AppDialogContent,
  AppDialogFooter,
  AppDialogHeader
} from '@/components/DialogShell'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { queryKeys } from '@/services/queryKeys'
import type { CustomEndpoint, EndpointPathConfig, EndpointProtocol } from '@/types/endpoints'

type OpenAiMode = Exclude<EndpointProtocol, 'anthropic'>

/** OpenAI families. `openai-auto` registers chat + responses + models. */
const OPENAI_MODES: OpenAiMode[] = ['openai-auto', 'openai-chat', 'openai-responses']

/**
 * One base path row. A row can serve both protocol families at once — on
 * submit it expands into one `paths[]` entry per family (same base path),
 * which is exactly what the proxy's `match_custom_route` expects.
 */
interface PathRow {
  key: number
  path: string
  anthropic: boolean
  openai: boolean
  openaiMode: OpenAiMode
}

let pathRowSequence = 0

function createPathRow(overrides: Partial<Omit<PathRow, 'key'>> = {}): PathRow {
  pathRowSequence += 1
  return {
    key: pathRowSequence,
    path: '',
    anthropic: false,
    openai: true,
    openaiMode: 'openai-auto',
    ...overrides
  }
}

function effectivePaths(endpoint?: CustomEndpoint): EndpointPathConfig[] {
  if (!endpoint) return []
  if (endpoint.paths && endpoint.paths.length > 0) return endpoint.paths
  if (endpoint.path && endpoint.protocol) {
    return [{ path: endpoint.path, protocol: endpoint.protocol }]
  }
  return []
}

/**
 * Collapse stored paths into one row per base path so an endpoint that serves
 * both families (two `paths[]` entries sharing a base path) is edited as a
 * single "Anthropic + OpenAI" row. Several OpenAI dialects on the same base
 * reduce to `openai-auto`, whose registered sub-paths are their union.
 */
function endpointToRows(endpoint?: CustomEndpoint): PathRow[] {
  const paths = effectivePaths(endpoint)
  if (paths.length === 0) return [createPathRow()]

  const grouped = new Map<string, EndpointProtocol[]>()
  for (const item of paths) {
    const protocols = grouped.get(item.path) ?? []
    protocols.push(item.protocol)
    grouped.set(item.path, protocols)
  }

  return [...grouped.entries()].map(([path, protocols]) => {
    const openaiProtocols = protocols.filter((protocol): protocol is OpenAiMode => protocol !== 'anthropic')
    const openaiMode: OpenAiMode =
      openaiProtocols.includes('openai-auto') || openaiProtocols.length > 1
        ? 'openai-auto'
        : openaiProtocols[0] ?? 'openai-auto'
    return createPathRow({
      path,
      anthropic: protocols.includes('anthropic'),
      openai: openaiProtocols.length > 0,
      openaiMode
    })
  })
}

/** Expand rows back into the stored `paths[]` shape (one entry per family). */
function rowsToPaths(rows: PathRow[]): EndpointPathConfig[] {
  const paths: EndpointPathConfig[] = []
  for (const row of rows) {
    const path = row.path.trim()
    if (row.anthropic) paths.push({ path, protocol: 'anthropic' })
    if (row.openai) paths.push({ path, protocol: row.openaiMode })
  }
  return paths
}

/** Preview of the sub-paths the proxy will register for a row. */
function rowResolvedPaths(row: PathRow): string[] {
  const trimmed = row.path.trim()
  const withLeading = trimmed && !trimmed.startsWith('/') ? `/${trimmed}` : trimmed
  const base = withLeading === '/' ? '' : withLeading.replace(/\/+$/, '')
  const resolved: string[] = []
  if (row.anthropic) {
    resolved.push(`${base}/v1/messages`)
    resolved.push(`${base}/v1/messages/count_tokens`)
  }
  if (row.openai) {
    if (row.openaiMode !== 'openai-responses') resolved.push(`${base}/v1/chat/completions`)
    if (row.openaiMode !== 'openai-chat') resolved.push(`${base}/v1/responses`)
    resolved.push(`${base}/v1/models`)
  }
  return resolved
}

/**
 * Create/edit dialog for a custom endpoint. Form content lives in the
 * scrollable body between a fixed header and footer. Clicking outside the
 * dialog must not close it — unsaved form state would be lost — so
 * onInteractOutside is prevented; Escape and the cancel/close buttons still
 * close it.
 */
export function EndpointDialog({
  open,
  endpoint,
  onClose,
  onSuccess
}: {
  open: boolean
  endpoint?: CustomEndpoint
  onClose: () => void
  onSuccess: (createdEndpointId?: string) => void
}) {
  const { t } = useTranslation()
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [formData, setFormData] = useState({
    id: '',
    label: '',
    paths: [createPathRow()],
    enabled: true
  })

  useEffect(() => {
    if (!open) return
    setSubmitAttempted(false)
    if (endpoint) {
      setFormData({
        id: endpoint.id,
        label: endpoint.label,
        paths: endpointToRows(endpoint),
        enabled: endpoint.enabled !== false
      })
      return
    }

    setFormData({
      id: '',
      label: '',
      paths: [createPathRow()],
      enabled: true
    })
  }, [endpoint, open])

  const createMutation = useAppMutation({
    mutationFn: customEndpointsApi.create,
    invalidateKeys: [queryKeys.customEndpoints.all()],
    successToast: () => ({ title: t('modelManagement.createEndpointSuccess') }),
    errorToast: (error) => ({ title: t('modelManagement.createEndpointError', { error: error.message }) }),
    onSuccess: async (response) => {
      onSuccess(response.endpoint?.id)
      onClose()
    }
  })

  const updateMutation = useAppMutation({
    mutationFn: (data: { id: string; updates: Parameters<typeof customEndpointsApi.update>[1] }) =>
      customEndpointsApi.update(data.id, data.updates),
    invalidateKeys: [queryKeys.customEndpoints.all()],
    successToast: () => ({ title: t('modelManagement.updateEndpointSuccess') }),
    errorToast: (error) => ({ title: t('modelManagement.updateEndpointError', { error: error.message }) }),
    onSuccess: async () => {
      onSuccess()
      onClose()
    }
  })

  const handleAddPath = () => {
    setFormData((previous) => ({
      ...previous,
      paths: [...previous.paths, createPathRow()]
    }))
  }

  const handleRemovePath = (index: number) => {
    if (formData.paths.length === 1) {
      return
    }

    setFormData((previous) => ({
      ...previous,
      paths: previous.paths.filter((_, pathIndex) => pathIndex !== index)
    }))
  }

  const updateRow = (index: number, updates: Partial<Omit<PathRow, 'key'>>) => {
    setFormData((previous) => {
      const nextPaths = [...previous.paths]
      nextPaths[index] = { ...nextPaths[index], ...updates }
      return { ...previous, paths: nextPaths }
    })
  }

  const handleSubmit = (event?: React.FormEvent) => {
    event?.preventDefault()
    setSubmitAttempted(true)

    if (!formData.id.trim() || !formData.label.trim()) {
      return
    }

    for (const pathItem of formData.paths) {
      if (!pathItem.path.trim() || (!pathItem.anthropic && !pathItem.openai)) {
        return
      }
    }

    const paths = rowsToPaths(formData.paths)
    if (paths.length === 0) {
      return
    }

    if (endpoint) {
      updateMutation.mutate({
        id: endpoint.id,
        updates: {
          label: formData.label.trim(),
          paths,
          enabled: formData.enabled
        }
      })
      return
    }

    createMutation.mutate({
      id: formData.id.trim(),
      label: formData.label.trim(),
      paths,
      enabled: formData.enabled
    })
  }

  const hasProtocolError = formData.paths.some(
    (pathItem) => pathItem.path.trim() && !pathItem.anthropic && !pathItem.openai
  )
  const isSubmitting = createMutation.isPending || updateMutation.isPending
  const validationError =
    formData.paths.length === 0
      ? t('modelManagement.atLeastOnePath')
      : !formData.id.trim() || !formData.label.trim()
        ? t('modelManagement.endpointValidationError')
        : formData.paths.some((pathItem) => !pathItem.path.trim())
          ? t('modelManagement.pathValidationError')
          : hasProtocolError
            ? t('modelManagement.protocolRequired')
            : null

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <AppDialogContent
        className="max-w-lg"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <AppDialogHeader>
          <DialogTitle>
            {endpoint ? t('modelManagement.editEndpoint') : t('modelManagement.createEndpoint')}
          </DialogTitle>
          <DialogDescription className="truncate font-mono text-xs">
            {endpoint ? endpoint.id : t('modelManagement.endpointRoutingHint')}
          </DialogDescription>
        </AppDialogHeader>

        <AppDialogBody>
          <form id="endpoint-form" onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label>
                {t('modelManagement.endpointId')} <span className="text-destructive">*</span>
              </Label>
              <Input
                value={formData.id}
                onChange={(event) => setFormData((previous) => ({ ...previous, id: event.target.value }))}
                placeholder={t('modelManagement.endpointIdPlaceholder')}
                disabled={!!endpoint}
              />
              <p className="text-xs text-muted-foreground">{t('modelManagement.endpointIdHint')}</p>
            </div>

            <div className="space-y-2">
              <Label>
                {t('modelManagement.endpointLabel')} <span className="text-destructive">*</span>
              </Label>
              <Input
                value={formData.label}
                onChange={(event) => setFormData((previous) => ({ ...previous, label: event.target.value }))}
                placeholder={t('modelManagement.endpointLabelPlaceholder')}
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>
                  {t('modelManagement.endpointPaths')} <span className="text-destructive">*</span>
                </Label>
                <Button type="button" variant="ghost" size="sm" onClick={handleAddPath}>
                  <Plus className="mr-1 h-3 w-3" />
                  {t('modelManagement.addPath')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('modelManagement.endpointPathHint')}</p>

              <div className="space-y-3">
                {formData.paths.map((pathItem, index) => {
                  const resolvedPaths = rowResolvedPaths(pathItem)
                  return (
                    <div
                      key={pathItem.key}
                      className="space-y-2 border border-border bg-card p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 space-y-2">
                          <Input
                            value={pathItem.path}
                            onChange={(event) => updateRow(index, { path: event.target.value })}
                            placeholder={t('modelManagement.endpointPathPlaceholder')}
                            aria-label={t('modelManagement.endpointPath')}
                          />
                          <div
                            role="group"
                            aria-label={t('modelManagement.endpointProtocols')}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <Button
                              type="button"
                              size="sm"
                              variant={pathItem.anthropic ? 'default' : 'outline'}
                              aria-pressed={pathItem.anthropic}
                              onClick={() => updateRow(index, { anthropic: !pathItem.anthropic })}
                            >
                              {t('modelManagement.protocolAnthropic')}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant={pathItem.openai ? 'default' : 'outline'}
                              aria-pressed={pathItem.openai}
                              onClick={() => updateRow(index, { openai: !pathItem.openai })}
                            >
                              {t('modelManagement.protocolOpenAI')}
                            </Button>
                            {pathItem.openai ? (
                              <Select
                                value={pathItem.openaiMode}
                                onValueChange={(value) =>
                                  updateRow(index, { openaiMode: value as OpenAiMode })
                                }
                              >
                                <SelectTrigger
                                  className="h-8 w-[190px]"
                                  aria-label={t('modelManagement.openAiMode')}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {OPENAI_MODES.map((mode) => (
                                    <SelectItem key={mode} value={mode}>
                                      {mode === 'openai-auto'
                                        ? t('modelManagement.openAiModeAuto')
                                        : mode === 'openai-chat'
                                          ? t('modelManagement.protocolOpenAIChat')
                                          : t('modelManagement.protocolOpenAIResponses')}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : null}
                          </div>
                        </div>

                        {formData.paths.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemovePath(index)}
                            className="text-destructive"
                            aria-label={t('modelManagement.removePath')}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        {resolvedPaths.length > 0 ? (
                          <div className="flex flex-wrap items-baseline gap-x-2 font-mono">
                            <span>{t('modelManagement.resolvedPathsLabel')}</span>
                            {resolvedPaths.map((resolvedPath) => (
                              <span key={resolvedPath} className="whitespace-nowrap">
                                {resolvedPath}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-destructive">{t('modelManagement.protocolRequired')}</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              {validationError && submitAttempted ? (
                <p className="text-xs text-destructive">{validationError}</p>
              ) : null}
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="endpoint-enabled"
                checked={formData.enabled}
                onCheckedChange={(checked) => setFormData((previous) => ({ ...previous, enabled: checked }))}
              />
              <Label htmlFor="endpoint-enabled">{t('modelManagement.endpointEnabled')}</Label>
            </div>

            {!endpoint ? (
              <div className="rounded-xl bg-secondary p-4">
                <p className="text-sm text-muted-foreground">
                  {t('modelManagement.endpointRoutingHint')}
                </p>
              </div>
            ) : null}
          </form>
        </AppDialogBody>

        <AppDialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="endpoint-form" disabled={isSubmitting}>
            {isSubmitting ? t('common.saving') : endpoint ? t('common.save') : t('common.create')}
          </Button>
        </AppDialogFooter>
      </AppDialogContent>
    </Dialog>
  )
}
