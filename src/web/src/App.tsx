import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppProviders } from '@/providers/AppProviders'
import { AppRouter } from '@/app/router'
import { AppErrorBoundary } from '@/components/AppErrorBoundary'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

function AppErrorFallback() {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
          <h1 className="text-base font-semibold text-foreground">{t('common.errorBoundary.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('common.errorBoundary.description')}</p>
          <Button onClick={() => window.location.reload()}>{t('common.errorBoundary.reload')}</Button>
        </CardContent>
      </Card>
    </div>
  )
}

export function App() {
  return (
    <AppProviders>
      <AppErrorBoundary fallback={<AppErrorFallback />}>
        <AppRouter />
      </AppErrorBoundary>
    </AppProviders>
  )
}

export default App
