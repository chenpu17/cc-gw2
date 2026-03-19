import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { customEndpointsApi } from '@/services/api'
import { useAppMutation } from '@/hooks/useAppMutation'
import { Button } from '@/components/ui/button'
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
import type { CustomEndpoint, EndpointProtocol } from '@/types/endpoints'

const PROTOCOL_OPTIONS: EndpointProtocol[] = [
  'anthropic',
  'openai-auto',
  'openai-chat',
  'openai-responses'
]

export function EndpointDrawer({
  open,
  endpoint,
  onClose,
  onSuccess
}: {
  open: boolean
  endpoint?: CustomEndpoint
  onClose: () => void
  onSuccess: () => void
}) {
  const { t } = useTranslation()
  const [formData, setFormData] = useState({
    id: '',
    label: '',
    paths: [{ path: '', protocol: 'openai-auto' as EndpointProtocol }],
    enabled: true
  })

  useEffect(() => {
    if (endpoint) {
      const paths = endpoint.paths && endpoint.paths.length > 0
        ? endpoint.paths
        : endpoint.path && endpoint.protocol
          ? [{ path: endpoint.path, protocol: endpoint.protocol }]
          : [{ path: '', protocol: 'openai-auto' as EndpointProtocol }]

      setFormData({
        id: endpoint.id,
        label: endpoint.label,
        paths,
        enabled: endpoint.enabled !== false
      })
      return
    }

    setFormData({
      id: '',
      label: '',
      paths: [{ path: '', protocol: 'openai-auto' as EndpointProtocol }],
      enabled: true
    })
  }, [endpoint, open])

  const createMutation = useAppMutation({
    mutationFn: customEndpointsApi.create,
    invalidateKeys: [queryKeys.customEndpoints.all()],
    successToast: () => ({ title: t('modelManagement.createEndpointSuccess') }),
    errorToast: (error) => ({ title: t('modelManagement.createEndpointError', { error: error.message }) }),
    onSuccess: async () => {
      onSuccess()
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
      paths: [...previous.paths, { path: '', protocol: 'anthropic' }]
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

  const handlePathChange = (index: number, field: 'path' | 'protocol', value: string) => {
    setFormData((previous) => {
      const nextPaths = [...previous.paths]
      nextPaths[index] = {
        ...nextPaths[index],
        [field]: value as EndpointProtocol
      }
      return {
        ...previous,
        paths: nextPaths
      }
    })
  }

  const handleSubmit = (event?: React.FormEvent) => {
    event?.preventDefault()

    if (!formData.id.trim() || !formData.label.trim()) {
      return
    }

    for (const pathItem of formData.paths) {
      if (!pathItem.path.trim()) {
        return
      }
    }

    const paths = formData.paths.map((pathItem) => ({
      path: pathItem.path.trim(),
      protocol: pathItem.protocol
    }))

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

  const isSubmitting = createMutation.isPending || updateMutation.isPending
  const validationError =
    formData.paths.length === 0
      ? t('modelManagement.atLeastOnePath')
      : !formData.id.trim() || !formData.label.trim()
        ? t('modelManagement.endpointValidationError')
        : formData.paths.some((pathItem) => !pathItem.path.trim())
          ? t('modelManagement.pathValidationError')
          : null

  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md border-l border-white/50 bg-background/96 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.4)] backdrop-blur-xl">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border/70 bg-background/70 p-6">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-[-0.02em]">
                {endpoint ? t('modelManagement.editEndpoint') : t('modelManagement.createEndpoint')}
              </h2>
              <p className="text-xs text-muted-foreground">
                {endpoint ? endpoint.id : t('modelManagement.endpointRoutingHint')}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 space-y-6 overflow-y-auto p-6">
            <div className="grid gap-3 rounded-[1.2rem] border border-border/70 bg-background/55 p-4 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {t('modelManagement.endpointId')}
                </p>
                <p className="truncate text-sm font-medium text-foreground">
                  {endpoint?.id || 'new-endpoint'}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {t('modelManagement.endpointEnabled')}
                </p>
                <p className="text-sm font-medium text-foreground">
                  {formData.enabled ? t('common.status.enabled') : t('common.status.disabled')}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>
                {t('modelManagement.endpointId')} <span className="text-destructive">*</span>
              </Label>
              <Input
                value={formData.id}
                onChange={(event) => setFormData((previous) => ({ ...previous, id: event.target.value }))}
                placeholder={t('modelManagement.endpointIdPlaceholder')}
                disabled={!!endpoint}
                required
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
                required
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

              <div className="space-y-3">
                {formData.paths.map((pathItem, index) => (
                  <div
                    key={`${pathItem.protocol}-${index}`}
                    className="space-y-2 rounded-[1.15rem] border border-white/50 bg-card/88 p-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 space-y-2">
                        <Input
                          value={pathItem.path}
                          onChange={(event) => handlePathChange(index, 'path', event.target.value)}
                          placeholder={t('modelManagement.endpointPathPlaceholder')}
                          required
                        />
                        <Select
                          value={pathItem.protocol}
                          onValueChange={(value) => handlePathChange(index, 'protocol', value)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PROTOCOL_OPTIONS.map((protocol) => (
                              <SelectItem key={protocol} value={protocol}>
                                {protocol === 'anthropic'
                                  ? t('modelManagement.protocolAnthropic')
                                  : protocol === 'openai-auto'
                                    ? t('modelManagement.protocolOpenAI')
                                    : protocol === 'openai-chat'
                                      ? t('modelManagement.protocolOpenAIChat')
                                      : t('modelManagement.protocolOpenAIResponses')}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {formData.paths.length > 1 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemovePath(index)}
                          className="text-destructive"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      {index === 0 ? <p>{t('modelManagement.endpointPathHint')}</p> : null}
                      <p>{t(`modelManagement.protocolHints.${pathItem.protocol}` as const)}</p>
                    </div>
                  </div>
                ))}
              </div>
              {validationError ? <p className="text-xs text-destructive">{validationError}</p> : null}
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="enabled"
                checked={formData.enabled}
                onCheckedChange={(checked) => setFormData((previous) => ({ ...previous, enabled: checked }))}
              />
              <Label htmlFor="enabled">{t('modelManagement.endpointEnabled')}</Label>
            </div>

            {!endpoint ? (
              <div className="rounded-[1.2rem] border border-blue-200 bg-blue-50/75 p-4 dark:border-blue-800 dark:bg-blue-950">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  {t('modelManagement.endpointRoutingHint')}
                </p>
              </div>
            ) : null}
          </form>

          <div className="flex gap-3 border-t border-border/70 bg-background/70 p-6">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={isSubmitting}>
              {t('common.cancel')}
            </Button>
            <Button className="flex-1" onClick={() => handleSubmit()} disabled={isSubmitting}>
              {isSubmitting ? t('common.saving') : endpoint ? t('common.save') : t('common.create')}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
