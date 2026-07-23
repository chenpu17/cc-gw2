import { Check, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EndpointSelector, useAvailableEndpoints } from '../api-keys/shared'
import type { SetupState } from './useSetupState'

export function SetupApiKeyStep({ state }: { state: SetupState }) {
  const { t } = useTranslation()
  const availableEndpoints = useAvailableEndpoints()
  const {
    keyName,
    setKeyName,
    keyEndpoints,
    setKeyEndpoints,
    keyMaxConcurrency,
    setKeyMaxConcurrency,
    creatingKey,
    createdKey,
    createApiKey,
    copyCreatedKey
  } = state

  if (createdKey) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
            <Check className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="text-sm font-semibold">{t('apiKeys.keyCreated')}</p>
        </div>
        <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
          {t('apiKeys.saveKeyWarning')}
        </p>
        <div className="break-all rounded-lg border border-border bg-secondary px-4 py-3 font-mono text-sm">
          {createdKey.key}
        </div>
        <div>
          <Button type="button" onClick={() => void copyCreatedKey(createdKey.key)}>
            <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('common.actions.copy')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="setupKeyName">{t('apiKeys.keyNamePlaceholder')} *</Label>
        <Input
          id="setupKeyName"
          value={keyName}
          onChange={(event) => setKeyName(event.target.value)}
          placeholder={t('apiKeys.keyNamePlaceholder')}
        />
      </div>
      <div className="space-y-2">
        <Label>{t('apiKeys.allowedEndpoints')}</Label>
        <EndpointSelector
          available={availableEndpoints}
          selected={keyEndpoints}
          onChange={setKeyEndpoints}
          hint={t('apiKeys.selectEndpoints')}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="setupMaxConcurrency">{t('apiKeys.maxConcurrency')}</Label>
        <Input
          id="setupMaxConcurrency"
          type="number"
          min="0"
          value={keyMaxConcurrency}
          onChange={(event) => setKeyMaxConcurrency(event.target.value)}
          placeholder={t('apiKeys.maxConcurrencyPlaceholder')}
        />
        <p className="text-xs text-muted-foreground">{t('apiKeys.maxConcurrencyHelper')}</p>
      </div>
      <div className="flex justify-end">
        <Button
          type="button"
          onClick={() => void createApiKey()}
          disabled={creatingKey || keyName.trim().length === 0}
        >
          {creatingKey ? t('setup.steps.apiKey.creating') : t('setup.steps.apiKey.create')}
        </Button>
      </div>
    </div>
  )
}
