import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useApiQuery } from '@/hooks/useApiQuery'
import { type ApiError } from '@/services/api'
import { apiKeysApi } from '@/services/apiKeys'
import { queryKeys } from '@/services/queryKeys'
import type { CustomEndpointsResponse } from '@/types/endpoints'

export interface EndpointOption {
  id: string
  label: string
}

export const RANGE_OPTIONS = [
  { value: 1, labelKey: 'apiKeys.analytics.range.today' },
  { value: 7, labelKey: 'apiKeys.analytics.range.week' },
  { value: 30, labelKey: 'apiKeys.analytics.range.month' }
] as const

export function useAvailableEndpoints(): EndpointOption[] {
  const builtIn: EndpointOption[] = [
    { id: 'anthropic', label: 'Anthropic' },
    { id: 'openai', label: 'OpenAI' }
  ]

  const customEndpointsQuery = useApiQuery<CustomEndpointsResponse, ApiError>(
    queryKeys.customEndpoints.all(),
    apiKeysApi.customEndpointOptionsRequest()
  )

  return useMemo(() => {
    const custom = (customEndpointsQuery.data?.endpoints ?? []).map((endpoint) => ({
      id: endpoint.id,
      label: endpoint.label || endpoint.id
    }))

    return [...builtIn, ...custom]
  }, [customEndpointsQuery.data?.endpoints])
}

export function EndpointSelector({
  available,
  hint,
  onChange,
  selected
}: {
  available: EndpointOption[]
  hint: string
  onChange: (next: string[]) => void
  selected: string[]
}) {
  const { t } = useTranslation()
  const allSelected = selected.length === 0

  const handleToggleAll = () => {
    onChange([])
  }

  const handleToggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((endpointId) => endpointId !== id))
      return
    }

    onChange([...selected, id])
  }

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border bg-secondary px-3 py-3 text-xs text-muted-foreground">
        {hint}
      </div>
      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:border-primary/20 hover:bg-accent/50">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={handleToggleAll}
          className="h-4 w-4 rounded border-input accent-primary"
        />
        <span className="text-sm font-medium">{t('apiKeys.allEndpoints')}</span>
      </label>
      <div className="grid max-h-40 gap-1 overflow-y-auto">
        {available.map((endpoint) => (
          <label
            key={endpoint.id}
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:border-primary/20 hover:bg-accent/50"
          >
            <input
              type="checkbox"
              checked={!allSelected && selected.includes(endpoint.id)}
              onChange={() => handleToggle(endpoint.id)}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            <span className="text-sm">{endpoint.label}</span>
            <span className="text-xs text-muted-foreground">({endpoint.id})</span>
          </label>
        ))}
      </div>
    </div>
  )
}
