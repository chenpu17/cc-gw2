import { useRef, useState } from 'react'
import { toApiError } from '@/services/api'
import type { ProviderConfig } from '@/types/providers'
import { useProviderForm } from './useProviderForm'

interface UseProviderDetailStateOptions {
  provider: ProviderConfig
  /** Full provider list — aggregate member reference validation. */
  providers: ProviderConfig[]
  onSubmit: (payload: ProviderConfig) => Promise<void>
}

/**
 * Inline-editing state for the provider detail panel: wraps the shared
 * {@link useProviderForm} with a dirty draft (serialize-vs-initial compare),
 * a single save action and discard. The panel is remounted per provider
 * (React key), so state initializes fresh per selection.
 */
export function useProviderDetailState({
  provider,
  providers,
  onSubmit
}: UseProviderDetailStateOptions) {
  const providerForm = useProviderForm({
    mode: 'edit',
    provider,
    existingProviderIds: [],
    providers
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Initial serialized snapshot — set on first render only.
  const initialJsonRef = useRef<string | null>(null)
  if (initialJsonRef.current === null) {
    initialJsonRef.current = JSON.stringify(providerForm.serialize())
  }
  const currentJson = JSON.stringify(providerForm.serialize())
  const dirty = currentJson !== initialJsonRef.current

  const save = async (): Promise<boolean> => {
    if (!providerForm.validate()) return false
    setSaving(true)
    setSaveError(null)
    try {
      const payload = providerForm.serialize()
      await onSubmit(payload)
      initialJsonRef.current = JSON.stringify(payload)
      return true
    } catch (error) {
      setSaveError(toApiError(error).message)
      return false
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    providerForm.resetForm()
    setSaveError(null)
  }

  return {
    providerForm,
    dirty,
    saving,
    saveError,
    save,
    discard
  }
}

export type ProviderDetailState = ReturnType<typeof useProviderDetailState>
