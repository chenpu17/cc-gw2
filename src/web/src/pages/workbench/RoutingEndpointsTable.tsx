import { useTranslation } from 'react-i18next'
import { GitBranch, Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import type { CustomEndpoint, EndpointProtocol } from '@/types/endpoints'
import type { DefaultsConfig } from '@/types/providers'
import { getEndpointProtocolLabel, type ManagementTab } from './shared'

/** Ingress paths served by the built-in endpoints (custom endpoints declare their own). */
const BUILTIN_ENDPOINT_PATHS: Record<string, string[]> = {
  anthropic: ['/anthropic/v1/messages'],
  openai: ['/openai/v1/chat/completions', '/openai/v1/responses']
}

function getEndpointPaths(endpoint: CustomEndpoint): Array<{ path: string; protocol: EndpointProtocol }> {
  if (endpoint.paths?.length) return endpoint.paths
  if (endpoint.path && endpoint.protocol) return [{ path: endpoint.path, protocol: endpoint.protocol }]
  if (endpoint.path) return [{ path: endpoint.path, protocol: 'anthropic' }]
  return []
}

interface EndpointRowModel {
  key: string
  label: string
  protocols: EndpointProtocol[]
  pathSummary: string
  enabled: boolean
  custom?: CustomEndpoint
}

/**
 * Routing view's endpoint table: every ingress endpoint (built-in first,
 * then custom) with its rule count and default forwarding target. Clicking a
 * row (or the routes action) opens the route editor dialog; edit/delete
 * actions apply to custom endpoints only.
 */
export function RoutingEndpointsTable({
  tabs,
  customEndpoints,
  routeCounts,
  defaultsByEndpoint,
  onEditRoute,
  onEditEndpoint,
  onDeleteEndpoint
}: {
  tabs: ManagementTab[]
  customEndpoints: CustomEndpoint[]
  routeCounts: Record<string, number>
  defaultsByEndpoint: Record<string, DefaultsConfig | undefined>
  onEditRoute: (endpointId: string) => void
  onEditEndpoint: (endpoint: CustomEndpoint) => void
  onDeleteEndpoint: (endpoint: CustomEndpoint) => void
}) {
  const { t } = useTranslation()

  const rows: EndpointRowModel[] = tabs.map((tab) => {
    const custom = customEndpoints.find((endpoint) => endpoint.id === tab.key)
    if (!custom) {
      return {
        key: tab.key,
        label: tab.label,
        protocols: (tab.protocols ?? []) as EndpointProtocol[],
        pathSummary: (BUILTIN_ENDPOINT_PATHS[tab.key] ?? []).join('  '),
        enabled: true
      }
    }
    const paths = getEndpointPaths(custom)
    return {
      key: tab.key,
      label: custom.label || custom.id,
      protocols: [...new Set(paths.map((item) => item.protocol))],
      pathSummary: paths.map((item) => item.path).join('  '),
      enabled: custom.enabled !== false,
      custom
    }
  })

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="px-4">{t('workbench.endpoints.table.name')}</TableHead>
              <TableHead>{t('workbench.endpoints.table.protocol')}</TableHead>
              <TableHead className="hidden md:table-cell">{t('workbench.endpoints.table.paths')}</TableHead>
              <TableHead className="whitespace-nowrap text-right">{t('workbench.endpoints.table.rules')}</TableHead>
              <TableHead className="hidden lg:table-cell">{t('workbench.endpoints.table.defaultTarget')}</TableHead>
              <TableHead>{t('workbench.endpoints.table.status')}</TableHead>
              <TableHead className="text-right">{t('workbench.endpoints.table.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const defaultTarget = defaultsByEndpoint[row.key]?.completion

              return (
                <TableRow
                  key={row.key}
                  data-testid="endpoint-row"
                  tabIndex={0}
                  onClick={() => onEditRoute(row.key)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onEditRoute(row.key)
                    }
                  }}
                  className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <TableCell className="max-w-[220px] px-4">
                    <p className="truncate text-sm font-medium text-foreground" title={row.label}>
                      {row.label}
                    </p>
                    {row.label !== row.key ? (
                      <code className="block truncate text-[11px] text-muted-foreground" title={row.key}>
                        {row.key}
                      </code>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {row.protocols.length > 0 ? (
                        row.protocols.map((protocol) => (
                          <Badge
                            key={protocol}
                            variant="outline"
                            className="rounded-full px-2 py-0.5 text-[10px] font-normal text-muted-foreground"
                          >
                            {getEndpointProtocolLabel(protocol, t)}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden max-w-[280px] md:table-cell">
                    {row.pathSummary ? (
                      <code className="block truncate text-xs text-muted-foreground" title={row.pathSummary}>
                        {row.pathSummary}
                      </code>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {routeCounts[row.key] ?? 0}
                  </TableCell>
                  <TableCell className="hidden max-w-[220px] lg:table-cell">
                    {defaultTarget ? (
                      <code className="block truncate text-xs text-muted-foreground" title={defaultTarget}>
                        {defaultTarget}
                      </code>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t('workbench.endpoints.defaultUnset')}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={row.enabled ? 'success' : 'secondary'}
                      className="whitespace-nowrap rounded-full border-0 px-2 py-0.5 text-[10px]"
                    >
                      {row.enabled
                        ? t('modelManagement.overview.endpointEnabled')
                        : t('modelManagement.overview.endpointDisabled')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-muted-foreground hover:text-foreground"
                        onClick={() => onEditRoute(row.key)}
                      >
                        <GitBranch className="mr-1 h-3.5 w-3.5" aria-hidden />
                        {t('workbench.endpoints.editRoute')}
                      </Button>
                      {row.custom ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          title={t('common.edit')}
                          onClick={(event) => {
                            event.stopPropagation()
                            onEditEndpoint(row.custom!)
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      ) : null}
                      {row.custom && row.custom.deletable !== false ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          title={t('common.delete')}
                          onClick={(event) => {
                            event.stopPropagation()
                            onDeleteEndpoint(row.custom!)
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
