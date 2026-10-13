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
 * {@link useProviderForm} with a dirty draft (raw-form vs initial compare),
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

  // Initial RAW form snapshot — set on first render only; nulled to force a
  // re-baseline after `discard` or after a clean re-sync below.
  // Raw, not serialize(): serialize() drops incomplete rows (endpoint without
  // id+baseUrl, named key without id, model without id), so "added an
  // endpoint, filled only the Base URL" compared as unchanged — the draft
  // looked clean and the row was silently dropped on switch. Dirty = "there
  // is unsaved input"; what passes validation and gets saved is a separate
  // question resolved at submit time.
  const initialFormJsonRef = useRef<string | null>(null)
  if (initialFormJsonRef.current === null) {
    initialFormJsonRef.current = JSON.stringify(providerForm.form)
  }
  const dirty = JSON.stringify(providerForm.form) !== initialFormJsonRef.current

  // The saved provider can change underneath the panel (config refetch after
  // another tab/CLI/endpoint dialog saved). A dirty draft always wins —
  // protecting unsaved edits is the point — but a clean panel must not keep
  // showing the mount-time snapshot, or the next small edit + save would
  // silently roll the external change back. Render-phase reset with a
  // re-baseline: the null snapshot re-initializes on the follow-up render.
  const savedProviderRef = useRef(provider)
  if (savedProviderRef.current !== provider) {
    savedProviderRef.current = provider
    if (!dirty) {
      providerForm.resetForm()
      initialFormJsonRef.current = null
    }
  }

  const save = async (): Promise<boolean> => {
    if (!providerForm.validate()) return false
    setSaving(true)
    setSaveError(null)
    try {
      const payload = providerForm.serialize()
      await onSubmit(payload)
      // Re-baseline the raw form as typed; the config refetch right after
      // save swaps in the canonical provider and the clean re-sync above
      // re-derives the form from it.
      initialFormJsonRef.current = JSON.stringify(providerForm.form)
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
    initialFormJsonRef.current = null
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
