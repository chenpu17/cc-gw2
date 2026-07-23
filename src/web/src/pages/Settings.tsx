import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PageLoadingState } from '@/components/PageState'
import { PageToolbar } from '@/components/PageToolbar'
import { Card, CardContent } from '@/components/ui/card'
import {
  BasicsSection,
  CleanupSection,
  ConfigFileSection,
  ProtocolSection,
  SecuritySection,
  SettingsSectionNav,
  StickySettingsSaveBar
} from './settings/SettingsSections'
import { useSettingsPageState } from './settings/useSettingsPageState'

export default function SettingsPage() {
  const { t } = useTranslation()
  const state = useSettingsPageState()
  const dirtyCount = Number(state.isConfigDirty) + Number(state.isAuthDirty)

  return (
    <div className="flex flex-col gap-6">
      <PageToolbar
        info={dirtyCount > 0 ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            {t('settings.overview.unsavedCount', { count: dirtyCount })}
          </span>
        ) : null}
        status={state.config ? (
          <span className="text-xs text-muted-foreground">
            {state.protocolChangesPending ? t('settings.protocol.restartWarning') : t('common.status.success')}
          </span>
        ) : null}
        actions={null}
      />

      {state.isLoading ? (
        <PageLoadingState label={t('common.loading')} />
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
                protocolChangesPending={state.protocolChangesPending}
                sectionRef={state.setSectionRef('section-protocol')}
              />

              <SecuritySection
                authErrors={state.authErrors}
                authForm={state.authForm}
                authLoading={state.authQuery.isPending || (!state.authSettings && state.authQuery.isFetching)}
                authSettings={state.authSettings}
                needsPassword={state.needsPassword}
                onSetAuthForm={state.setAuthForm}
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
            dirtyCount={dirtyCount}
            protocolChangesPending={state.protocolChangesPending}
            onReset={state.handleResetAll}
            onSave={() => void state.handleSaveAll()}
            saving={state.saving || state.savingAuth}
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
