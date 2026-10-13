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

  // Initial serialized snapshot — set on first render only; nulled to force a
  // re-baseline after `discard` or after a clean re-sync below.
  const initialJsonRef = useRef<string | null>(null)
  if (initialJsonRef.current === null) {
    initialJsonRef.current = JSON.stringify(providerForm.serialize())
  }
  const currentJson = JSON.stringify(providerForm.serialize())
  const dirty = currentJson !== initialJsonRef.current

  // The saved provider can change underneath the panel (config refetch after
  // another tab/CLI/endpoint dialog saved). A dirty draft always wins —
  // protecting unsaved edits is the point — but a clean panel must not keep
  // showing the mount-time snapshot, or the next small edit + save would
  // silently roll the external change back. Render-phase reset with a
  // re-baseline: the null initialJson re-initializes on the follow-up render.
  const savedProviderRef = useRef(provider)
  if (savedProviderRef.current !== provider) {
    savedProviderRef.current = provider
    if (!dirty) {
      providerForm.resetForm()
      initialJsonRef.current = null
    }
  }

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
    initialJsonRef.current = null
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
