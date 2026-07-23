import { useTranslation } from 'react-i18next'
import { ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageState } from '@/components/PageState'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import type { CustomEndpoint, EndpointProtocol } from '@/types/endpoints'

function getProtocolLabel(protocol: EndpointProtocol, t: (key: string) => string) {
  if (protocol === 'anthropic') return t('modelManagement.protocolAnthropic')
  if (protocol === 'openai-chat') return t('modelManagement.protocolOpenAIChat')
  if (protocol === 'openai-responses') return t('modelManagement.protocolOpenAIResponses')
  return t('modelManagement.protocolOpenAI')
}

function getEndpointPaths(endpoint: CustomEndpoint): Array<{ path: string; protocol: EndpointProtocol }> {
  if (endpoint.paths?.length) return endpoint.paths
  if (endpoint.path && endpoint.protocol) return [{ path: endpoint.path, protocol: endpoint.protocol }]
  if (endpoint.path) return [{ path: endpoint.path, protocol: 'anthropic' }]
  return []
}

/**
 * Full-width custom endpoints table in the workbench "endpoints" view:
 * one clickable row per endpoint (opens the edit dialog), with edit/delete
 * actions and an empty state that guides creation.
 */
export function EndpointsTable({
  customEndpoints,
  routeCounts,
  endpointsPending,
  onSelect,
  onEdit,
  onDelete,
  onCreate
}: {
  customEndpoints: CustomEndpoint[]
  routeCounts: Record<string, number>
  endpointsPending: boolean
  onSelect: (endpoint: CustomEndpoint) => void
  onEdit: (endpoint: CustomEndpoint) => void
  onDelete: (endpoint: CustomEndpoint) => void
  onCreate: () => void
}) {
  const { t } = useTranslation()

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        {endpointsPending ? (
          <div className="flex min-h-[160px] items-center justify-center text-sm text-muted-foreground">
            {t('common.loading')}
          </div>
        ) : customEndpoints.length === 0 ? (
          <PageState
            compact
            title={t('workbench.endpoints.emptyTitle')}
            description={t('workbench.endpoints.emptyDescription')}
            action={(
              <Button size="sm" onClick={onCreate}>
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
                {t('workbench.endpoints.create')}
              </Button>
            )}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4">{t('workbench.endpoints.table.name')}</TableHead>
                <TableHead>{t('workbench.endpoints.table.protocol')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('workbench.endpoints.table.paths')}</TableHead>
                <TableHead className="text-right">{t('workbench.endpoints.table.rules')}</TableHead>
                <TableHead>{t('workbench.endpoints.table.status')}</TableHead>
                <TableHead className="text-right">{t('workbench.endpoints.table.actions')}</TableHead>
                <TableHead className="w-8 px-2">
                  <span className="sr-only">{t('common.edit')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customEndpoints.map((endpoint) => {
                const paths = getEndpointPaths(endpoint)
                const protocols = [...new Set(paths.map((item) => item.protocol))]
                const pathSummary = paths.map((item) => item.path).join('  ')
                const enabled = endpoint.enabled !== false

                return (
                  <TableRow
                    key={endpoint.id}
                    data-testid="endpoint-row"
                    tabIndex={0}
                    onClick={() => onSelect(endpoint)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onSelect(endpoint)
                      }
                    }}
                    className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <TableCell className="max-w-[220px] px-4">
                      <p className="truncate text-sm font-medium text-foreground" title={endpoint.label || endpoint.id}>
                        {endpoint.label || endpoint.id}
                      </p>
                      {endpoint.label && endpoint.label !== endpoint.id ? (
                        <code className="block truncate text-[11px] text-muted-foreground" title={endpoint.id}>
                          {endpoint.id}
                        </code>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {protocols.length > 0 ? (
                          protocols.map((protocol) => (
                            <Badge
                              key={protocol}
                              variant="outline"
                              className="rounded-full px-2 py-0.5 text-[10px] font-normal text-muted-foreground"
                            >
                              {getProtocolLabel(protocol, t)}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden max-w-[280px] md:table-cell">
                      {pathSummary ? (
                        <code className="block truncate text-xs text-muted-foreground" title={pathSummary}>
                          {pathSummary}
                        </code>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {routeCounts[endpoint.id] ?? 0}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={enabled ? 'success' : 'secondary'}
                        className="rounded-full border-0 px-2 py-0.5 text-[10px]"
                      >
                        {enabled
                          ? t('modelManagement.overview.endpointEnabled')
                          : t('modelManagement.overview.endpointDisabled')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          title={t('common.edit')}
                          onClick={(event) => {
                            event.stopPropagation()
                            onEdit(endpoint)
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                        {endpoint.deletable !== false ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            title={t('common.delete')}
                            onClick={(event) => {
                              event.stopPropagation()
                              onDelete(endpoint)
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="px-2">
                      <ChevronRight className="h-4 w-4 text-muted-foreground/60" aria-hidden />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
