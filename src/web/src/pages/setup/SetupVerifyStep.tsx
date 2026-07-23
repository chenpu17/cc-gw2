import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { TestResultInline } from '../workbench/TestResultInline'
import type { SetupState } from './useSetupState'

export function SetupVerifyStep({ state }: { state: SetupState }) {
  const { t } = useTranslation()
  const {
    setupProvider,
    testingProvider,
    testResult,
    testSetupProvider,
    anthropicBaseUrl,
    createdKey,
    copyCreatedKey
  } = state

  if (!setupProvider) {
    return (
      <p className="rounded-xl bg-secondary/50 px-4 py-3 text-xs text-muted-foreground">
        {t('setup.steps.verify.noProvider')}
      </p>
    )
  }

  const envSnippet = [
    `export ANTHROPIC_BASE_URL=${anthropicBaseUrl}`,
    `export ANTHROPIC_API_KEY=${createdKey?.key ?? '<your-api-key>'}`
  ].join('\n')

  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-labelledby="setup-verify-connection">
        <div className="space-y-1">
          <h3 id="setup-verify-connection" className="text-sm font-semibold">
            {t('workbench.drawer.verifyTitle')}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t('setup.steps.verify.testingProvider', { name: setupProvider.label || setupProvider.id })}
          </p>
        </div>
        <div className="space-y-3 rounded-xl border border-transparent bg-card p-4 shadow-[var(--surface-shadow)]">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void testSetupProvider()}
            disabled={testingProvider}
          >
            {testingProvider ? t('common.actions.testingConnection') : t('workbench.drawer.verifyRun')}
          </Button>
          {testResult ? <TestResultInline result={testResult} /> : null}
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="setup-verify-first-request">
        <div className="space-y-1">
          <h3 id="setup-verify-first-request" className="text-sm font-semibold">
            {t('setup.steps.verify.envTitle')}
          </h3>
          <p className="text-xs text-muted-foreground">{t('setup.steps.verify.envHint')}</p>
        </div>
        <pre className="overflow-x-auto rounded-lg border border-border bg-secondary px-4 py-3 font-mono text-xs">
          {envSnippet}
        </pre>
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => void copyCreatedKey(envSnippet)}>
            <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('common.actions.copy')}
          </Button>
        </div>
      </section>
    </div>
  )
}
