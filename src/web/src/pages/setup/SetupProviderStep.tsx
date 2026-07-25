import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { ProviderConfig } from '@/types/providers'
import {
  BasicsStep,
  ModelsStep,
  type ProviderStepShared
} from '../workbench/ProviderDrawerSteps'
import { useProviderForm } from '../workbench/useProviderForm'
import type { SetupState } from './useSetupState'

function ProviderCreateForm({
  existingProviderIds,
  saving,
  onSave
}: {
  existingProviderIds: string[]
  saving: boolean
  onSave: (payload: ProviderConfig) => void
}) {
  const { t } = useTranslation()
  const providerForm = useProviderForm({ mode: 'create', existingProviderIds })

  const stepProps: ProviderStepShared = {
    form: providerForm.form,
    errors: providerForm.errors,
    isCreate: true,
    advancedOpen: providerForm.advancedOpen,
    onAdvancedOpenChange: providerForm.setAdvancedOpen,
    idInputRef: providerForm.providerIdRef,
    onProviderIdChange: providerForm.handleProviderIdChange,
    onFieldChange: providerForm.handleFieldChange,
    onTypeChange: providerForm.handleTypeChange,
    onAuthModeChange: providerForm.handleAuthModeChange,
    onNonStreamViaStreamChange: providerForm.handleProviderNonStreamViaStreamChange,
    onUseAbsoluteUrlChange: providerForm.handleUseAbsoluteUrlChange,
    onAddHeader: providerForm.handleAddHeader,
    onRemoveHeader: providerForm.handleRemoveHeader,
    onHeaderChange: providerForm.handleHeaderChange,
    onModelIdChange: providerForm.handleModelIdChange,
    onModelChange: providerForm.handleModelChange,
    onAddModel: providerForm.handleAddModel,
    onRemoveModel: providerForm.handleRemoveModel,
    onModelNonStreamViaStreamChange: providerForm.handleModelNonStreamViaStreamChange,
    onSetDefaultModel: providerForm.handleSetDefaultModel
  }

  const handleSave = () => {
    if (!providerForm.validate()) return
    onSave(providerForm.serialize())
  }

  return (
    <div className="space-y-8">
      <BasicsStep {...stepProps} />
      <ModelsStep {...stepProps} />
      <div className="flex justify-end">
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? t('common.actions.saving') : t('setup.steps.provider.saveAndContinue')}
        </Button>
      </div>
    </div>
  )
}

export function SetupProviderStep({
  state,
  onSaved
}: {
  state: SetupState
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const { providers, setupProvider, setSetupProviderId, savingProvider, saveProvider } = state
  const [formRequested, setFormRequested] = useState<boolean | null>(null)
  const showForm = formRequested ?? providers.length === 0

  const handleSave = (payload: ProviderConfig) => {
    void saveProvider(payload).then((saved) => {
      if (saved) onSaved()
    })
  }

  return (
    <div className="space-y-6">
      {providers.length > 0 ? (
        <div className="space-y-3 rounded-xl bg-secondary/50 p-4">
          <p className="text-sm font-semibold">
            {t('setup.steps.provider.existingTitle', { count: providers.length })}
          </p>
          <p className="text-xs text-muted-foreground">{t('setup.steps.provider.existingHint')}</p>
          <Label className="flex flex-col gap-2 text-sm">
            <span className="text-xs text-muted-foreground">{t('setup.steps.provider.chooseLabel')}</span>
            <Select value={setupProvider?.id ?? ''} onValueChange={setSetupProviderId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providers.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.label || provider.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
        </div>
      ) : null}

      {showForm ? (
        <ProviderCreateForm
          existingProviderIds={providers.map((provider) => provider.id)}
          saving={savingProvider}
          onSave={handleSave}
        />
      ) : (
        <div>
          <Button type="button" variant="outline" onClick={() => setFormRequested(true)}>
            {t('setup.steps.provider.addAnother')}
          </Button>
        </div>
      )}

      {showForm && providers.length > 0 ? (
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setFormRequested(false)}>
            {t('setup.steps.provider.backToList')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
