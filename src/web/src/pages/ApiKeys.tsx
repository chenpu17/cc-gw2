import { Key, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Loader } from '@/components/Loader'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
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
  const headerBadge = t('apiKeys.summary.totalCount', { count: state.keys.length })

  if (state.keysQuery.isLoading) {
    return <Loader />
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={<Key className="h-5 w-5" aria-hidden="true" />}
        title={t('apiKeys.title')}
        description={t('apiKeys.description')}
        eyebrow="Access Control"
        breadcrumb="Gateway / API Keys"
        helper={t('apiKeys.helper')}
        badge={headerBadge}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
            <div className="rounded-lg border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
              {t('apiKeys.summary.wildcard', { count: state.wildcardCount })}
              {' / '}
              {t('apiKeys.summary.restricted', { count: state.restrictedCount })}
              {' / '}
              {t('apiKeys.summary.unrestricted', { count: state.unrestrictedCount })}
            </div>
            <Button onClick={() => state.handleCreateDialogChange(true)} className="w-full sm:w-auto">
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('apiKeys.createNew')}
            </Button>
          </div>
        }
      />

      <ApiKeysQuickStartSection />

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
        restrictedCount={state.restrictedCount}
        revealedKeys={state.revealedKeys}
        search={state.search}
        statusFilter={state.statusFilter}
        unrestrictedCount={state.unrestrictedCount}
        wildcardCount={state.wildcardCount}
      />

      <CreateApiKeyDialog
        availableEndpoints={state.availableEndpoints}
        isOpen={state.isCreateDialogOpen}
        keyDescription={state.newKeyDescription}
        keyName={state.newKeyName}
        onDescriptionChange={state.setNewKeyDescription}
        onEndpointsChange={state.setNewKeyEndpoints}
        onKeyNameChange={state.setNewKeyName}
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
        onClose={() => state.setEditEndpointsKey(null)}
        onEndpointsChange={state.setEditEndpointsSelection}
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
