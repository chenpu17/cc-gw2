import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageLoadingState } from '@/components/PageState'
import { PageToolbar } from '@/components/PageToolbar'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ApiKeyCreatedDialog,
  CreateApiKeyDialog,
  DeleteApiKeyDialog,
  EditApiKeyEndpointsDialog
} from './api-keys/ApiKeysDialogs'
import {
  ApiKeysAnalyticsSection,
  ApiKeysInventorySection,
  ApiKeysQuickStartSection
} from './api-keys/ApiKeysSections'
import { useApiKeysPageState } from './api-keys/useApiKeysPageState'

export default function ApiKeysPage() {
  const { t } = useTranslation()
  const state = useApiKeysPageState()

  if (state.keysQuery.isLoading) {
    return <PageLoadingState label={t('common.loading')} />
  }

  const namedKeyCount = state.keys.filter((key) => !key.isWildcard).length
  const showQuickStart = namedKeyCount === 0 && !state.quickStartDismissed

  return (
    <div className="flex flex-col gap-6">
      <PageToolbar
        status={
          <span className="text-xs text-muted-foreground">
            {t('apiKeys.summary.wildcard', { count: state.wildcardCount })}
            {' / '}
            {t('apiKeys.summary.restricted', { count: state.restrictedCount })}
            {' / '}
            {t('apiKeys.summary.unrestricted', { count: state.unrestrictedCount })}
          </span>
        }
        actions={
          <Button size="sm" onClick={() => state.handleCreateDialogChange(true)}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('apiKeys.createNew')}
          </Button>
        }
      />

      {showQuickStart ? (
        <ApiKeysQuickStartSection onDismiss={() => state.setQuickStartDismissed(true)} />
      ) : null}

      <Tabs
        value={state.activeTab}
        onValueChange={(value) => state.setActiveTab(value as 'inventory' | 'analytics')}
      >
        <TabsList>
          <TabsTrigger value="inventory">{t('apiKeys.tabs.inventory')}</TabsTrigger>
          <TabsTrigger value="analytics">{t('apiKeys.tabs.analytics')}</TabsTrigger>
        </TabsList>
        <TabsContent value="inventory" className="mt-4">
          <ApiKeysInventorySection
            filteredKeys={state.filteredKeys}
            formatDate={state.formatDate}
            hasWildcard={state.hasWildcard}
            isDeleting={state.isDeleting}
            isRevealing={state.isRevealing}
            keys={state.keys}
            onCopy={(key) => void state.handleCopyKey(key)}
            onDelete={state.setDeleteTarget}
            onEditEndpoints={state.handleOpenEditEndpoints}
            onFilterChange={state.setSearch}
            onHide={state.handleHideKey}
            onReveal={(id) => void state.handleRevealKey(id)}
            onStatusFilterChange={state.setStatusFilter}
            onToggleEnabled={(id, enabled) => void state.handleToggleEnabled(id, enabled)}
            revealedKeys={state.revealedKeys}
            search={state.search}
            statusFilter={state.statusFilter}
            viewMode={state.viewMode}
            onViewModeChange={state.setViewMode}
            onCreateKey={() => state.handleCreateDialogChange(true)}
          />
        </TabsContent>
        <TabsContent value="analytics" className="mt-4">
          <ApiKeysAnalyticsSection
            activeKeysValue={state.activeKeysValue}
            enabledKeysValue={state.enabledKeysValue}
            loading={state.usageQuery.isLoading}
            onRangeChange={state.setRangeDays}
            rangeDays={state.rangeDays}
            requestsChartOption={state.requestsChartOption}
            totalKeysValue={state.totalKeysValue}
            tokensChartOption={state.tokensChartOption}
            usageLength={state.usage.length}
          />
        </TabsContent>
      </Tabs>

      <CreateApiKeyDialog
        availableEndpoints={state.availableEndpoints}
        isOpen={state.isCreateDialogOpen}
        keyDescription={state.newKeyDescription}
        keyName={state.newKeyName}
        maxConcurrency={state.newKeyMaxConcurrency}
        onDescriptionChange={state.setNewKeyDescription}
        onEndpointsChange={state.setNewKeyEndpoints}
        onKeyNameChange={state.setNewKeyName}
        onMaxConcurrencyChange={state.setNewKeyMaxConcurrency}
        onOpenChange={state.handleCreateDialogChange}
        onSubmit={() => void state.handleCreateKey()}
        selectedEndpoints={state.newKeyEndpoints}
      />

      <ApiKeyCreatedDialog
        createdKey={state.newlyCreatedKey}
        onClose={() => state.setNewlyCreatedKey(null)}
        onCopy={(key) => void state.handleCopyKey(key)}
      />

      <EditApiKeyEndpointsDialog
        apiKey={state.editEndpointsKey}
        availableEndpoints={state.availableEndpoints}
        maxConcurrency={state.editMaxConcurrency}
        onClose={() => state.setEditEndpointsKey(null)}
        onEndpointsChange={state.setEditEndpointsSelection}
        onMaxConcurrencyChange={state.setEditMaxConcurrency}
        onSave={() => void state.handleSaveEndpoints()}
        selectedEndpoints={state.editEndpointsSelection}
      />

      <DeleteApiKeyDialog
        deleteTarget={state.deleteTarget}
        isDeleting={state.isDeleting}
        onConfirm={() => void state.handleDeleteKey()}
        onOpenChange={(open) => {
          if (!open && state.isDeleting === null) {
            state.setDeleteTarget(null)
          }
        }}
      />
    </div>
  )
}
