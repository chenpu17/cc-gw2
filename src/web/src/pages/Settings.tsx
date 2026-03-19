import { Settings as SettingsIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Loader } from '@/components/Loader'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  BasicsSection,
  CleanupSection,
  ConfigFileSection,
  ProtocolSection,
  SecuritySection,
  SettingsOverviewPanel,
  SettingsSectionNav,
  StickySettingsSaveBar
} from './settings/SettingsSections'
import { useSettingsPageState } from './settings/useSettingsPageState'

export default function SettingsPage() {
  const { t } = useTranslation()
  const state = useSettingsPageState()
  const dirtyCount = Number(state.isConfigDirty) + Number(state.isAuthDirty)
  const headerHelper = state.protocolChangesPending
    ? t('settings.protocol.restartHint')
    : t('settings.overview.description')

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={<SettingsIcon className="h-5 w-5" aria-hidden="true" />}
        title={t('settings.title')}
        description={t('settings.description')}
        eyebrow="Gateway Controls"
        breadcrumb="Gateway / Settings"
        helper={headerHelper}
        badge={dirtyCount > 0 ? t('settings.overview.unsavedCount', { count: dirtyCount }) : undefined}
        actions={
          state.config ? (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <div className="rounded-2xl border border-border/70 bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                {state.protocolChangesPending ? t('settings.protocol.restartWarning') : t('common.status.success')}
              </div>
              <Button variant="outline" onClick={state.handleReset} disabled={state.saving || !state.isConfigDirty} className="w-full sm:w-auto">
                {t('common.actions.reset')}
              </Button>
              <Button onClick={() => void state.handleSave()} disabled={state.saving || !state.isConfigDirty} className="w-full sm:w-auto">
                {state.saving ? t('common.actions.saving') : t('common.actions.save')}
              </Button>
            </div>
          ) : null
        }
      />

      {state.isLoading ? (
        <Card>
          <CardContent className="flex min-h-[220px] items-center justify-center">
            <Loader />
          </CardContent>
        </Card>
      ) : !state.config ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-destructive">{t('settings.toast.missingConfig')}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-[200px_1fr]">
            <SettingsSectionNav
              activeSection={state.activeSection}
              onSelectSection={state.handleSectionClick}
            />

            <div className="flex flex-col gap-6">
              <SettingsOverviewPanel
                configPath={state.configPath}
                defaultsSummary={state.defaultsSummary}
                form={state.form}
                protocolSummaryLabel={state.protocolSummaryLabel}
                protocolChangesPending={state.protocolChangesPending}
                isAuthDirty={state.isAuthDirty}
                isConfigDirty={state.isConfigDirty}
                authEnabled={state.authSettings?.enabled ?? false}
                authUsername={state.authSettings?.username}
              />

              <BasicsSection
                defaultsSummary={state.defaultsSummary}
                errors={state.errors}
                form={state.form}
                onInputChange={state.handleInputChange}
                onSetForm={state.setForm}
                sectionRef={state.setSectionRef('section-basics')}
              />

              <ProtocolSection
                errors={state.errors}
                form={state.form}
                onSetForm={state.setForm}
                sectionRef={state.setSectionRef('section-protocol')}
              />

              <SecuritySection
                authErrors={state.authErrors}
                authForm={state.authForm}
                authLoading={state.authQuery.isPending || (!state.authSettings && state.authQuery.isFetching)}
                authSettings={state.authSettings}
                needsPassword={state.needsPassword}
                onAuthReset={state.handleAuthReset}
                onAuthSave={() => void state.handleAuthSave()}
                onSetAuthForm={state.setAuthForm}
                savingAuth={state.savingAuth}
                isAuthDirty={state.isAuthDirty}
                sectionRef={state.setSectionRef('section-security')}
              />

              <ConfigFileSection
                configPath={state.configPath}
                onCopyPath={() => void state.handleCopyPath()}
                sectionRef={state.setSectionRef('section-config-file')}
              />

              <CleanupSection
                cleaning={state.cleaning}
                clearingAll={state.clearingAll}
                onOpenCleanup={() => state.setConfirmCleanupOpen(true)}
                onOpenClearAll={() => state.setConfirmClearAllOpen(true)}
                sectionRef={state.setSectionRef('section-cleanup')}
              />
            </div>
          </div>

          <StickySettingsSaveBar
            isAuthDirty={state.isAuthDirty}
            isConfigDirty={state.isConfigDirty}
            protocolChangesPending={state.protocolChangesPending}
            onAuthReset={state.handleAuthReset}
            onAuthSave={() => void state.handleAuthSave()}
            onReset={state.handleReset}
            onSave={() => void state.handleSave()}
            saving={state.saving}
            savingAuth={state.savingAuth}
          />
        </>
      )}

      <ConfirmDialog
        open={state.confirmCleanupOpen}
        onOpenChange={(open) => {
          if (!open && !state.cleaning) {
            state.setConfirmCleanupOpen(false)
          }
        }}
        title={t('settings.cleanup.confirmTitle')}
        description={t('settings.cleanup.confirmDescription')}
        confirmLabel={state.cleaning ? t('common.actions.cleaning') : t('common.actions.cleanup')}
        cancelLabel={t('common.actions.cancel')}
        loading={state.cleaning}
        onConfirm={async () => {
          await state.handleCleanupLogs()
          state.setConfirmCleanupOpen(false)
        }}
      />

      <ConfirmDialog
        open={state.confirmClearAllOpen}
        onOpenChange={(open) => {
          if (!open && !state.clearingAll) {
            state.setConfirmClearAllOpen(false)
          }
        }}
        title={t('settings.cleanup.clearAllTitle')}
        description={t('settings.cleanup.clearAllWarning')}
        confirmLabel={state.clearingAll ? t('settings.cleanup.clearingAll') : t('settings.cleanup.clearAll')}
        cancelLabel={t('common.actions.cancel')}
        loading={state.clearingAll}
        onConfirm={async () => {
          await state.handleClearAllLogs()
          state.setConfirmClearAllOpen(false)
        }}
      />
    </div>
  )
}
