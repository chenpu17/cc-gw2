import { useTranslation } from 'react-i18next'
import { Loader } from '@/components/Loader'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { StepNav, type StepNavItem } from '@/components/ui/step-nav'
import { SetupApiKeyStep } from './setup/SetupApiKeyStep'
import { SetupProviderStep } from './setup/SetupProviderStep'
import { SetupRoutingStep } from './setup/SetupRoutingStep'
import { SetupVerifyStep } from './setup/SetupVerifyStep'
import { SETUP_STEPS, useSetupState } from './setup/useSetupState'

export default function SetupPage() {
  const { t } = useTranslation()
  const state = useSetupState()

  if (state.configQuery.isPending && !state.config) {
    return <Loader />
  }

  const stepItems: StepNavItem[] = SETUP_STEPS.map((id, index) => ({
    id,
    label: t(`setup.steps.${id}.navLabel`),
    status: index < state.stepIndex ? 'complete' : index === state.stepIndex ? 'current' : 'upcoming'
  }))

  const isLastStep = state.stepIndex === SETUP_STEPS.length - 1

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-[-0.02em]">{t('setup.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('setup.description')}</p>
      </header>

      <StepNav steps={stepItems} current={state.activeStep} onSelect={state.goToStep} />

      <Card>
        <CardHeader>
          <CardTitle>{t(`setup.steps.${state.activeStep}.title`)}</CardTitle>
          <CardDescription>{t(`setup.steps.${state.activeStep}.description`)}</CardDescription>
        </CardHeader>
        <CardContent>
          {state.activeStep === 'provider' ? (
            <SetupProviderStep state={state} onSaved={state.goNext} />
          ) : null}
          {state.activeStep === 'routing' ? <SetupRoutingStep state={state} /> : null}
          {state.activeStep === 'apiKey' ? <SetupApiKeyStep state={state} /> : null}
          {state.activeStep === 'verify' ? <SetupVerifyStep state={state} /> : null}
        </CardContent>
      </Card>

      <footer className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={state.goBack}
          disabled={state.stepIndex === 0}
        >
          {t('common.actions.previous')}
        </Button>
        {isLastStep ? (
          <Button type="button" onClick={state.finish}>
            {t('setup.actions.finish')}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={state.goNext}
            disabled={!state.canProceed[state.activeStep]}
          >
            {t('common.actions.next')}
          </Button>
        )}
      </footer>
    </div>
  )
}
