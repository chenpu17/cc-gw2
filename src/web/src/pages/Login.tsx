import { FormEvent, useEffect, useMemo, useState, type ReactNode } from 'react'
import { LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { Loader } from '@/components/Loader'
import { useAuth } from '@/providers/AuthProvider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface LocationState {
  from?: {
    pathname?: string
  }
}

export default function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { authEnabled, isAuthenticated, loading, login, error } = useAuth()
  const [form, setForm] = useState({ username: '', password: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const fallbackTarget = useMemo(() => {
    const state = location.state as LocationState | undefined
    return state?.from?.pathname ?? '/'
  }, [location.state])

  useEffect(() => {
    if (!authEnabled && !loading) {
      navigate(fallbackTarget, { replace: true })
      return
    }
    if (authEnabled && isAuthenticated && !loading) {
      navigate(fallbackTarget, { replace: true })
    }
  }, [authEnabled, fallbackTarget, isAuthenticated, loading, navigate])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    if (!form.username.trim() || !form.password) {
      setFormError(t('login.validation.required'))
      return
    }

    setSubmitting(true)
    try {
      await login(form.username.trim(), form.password)
      navigate(fallbackTarget, { replace: true })
    } catch (authErr) {
      setFormError(authErr instanceof Error ? authErr.message : t('login.validation.failed'))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(225,93,73,0.2),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(37,99,235,0.14),transparent_28%),linear-gradient(160deg,rgba(247,244,239,1),rgba(255,251,247,0.96))] px-4 py-10">
        <Card className="w-full max-w-md border-[rgba(24,16,13,0.08)] bg-white/88 shadow-[0_28px_70px_-40px_rgba(17,12,11,0.32)] backdrop-blur-xl">
          <CardContent className="flex min-h-[320px] items-center justify-center">
            <Loader />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!authEnabled) {
    return null
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(225,93,73,0.22),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(37,99,235,0.14),transparent_28%),linear-gradient(160deg,rgba(247,244,239,1),rgba(255,251,247,0.96))] px-4 py-10">
      <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.2),transparent_36%,rgba(225,93,73,0.05))]" aria-hidden="true" />
      <div className="relative mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.85fr)]">
        <div className="space-y-4 lg:hidden">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-white/75 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary shadow-[0_10px_24px_-20px_rgba(225,93,73,0.35)]">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Secure gateway control
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-slate-50">
              {t('login.title')}
            </h1>
            <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
              {t('login.description')}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FeatureCard
              icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
              title={t('login.hint')}
              description={t('about.support.tip')}
            />
            <FeatureCard
              icon={<LockKeyhole className="h-5 w-5" aria-hidden="true" />}
              title="Session protected"
              description={t('help.note')}
            />
          </div>
        </div>

        <div className="hidden lg:block">
          <div className="max-w-2xl space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-white/75 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary shadow-[0_10px_24px_-20px_rgba(225,93,73,0.35)]">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Secure gateway control
            </div>
            <div className="space-y-3">
              <h1 className="text-5xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-slate-50">
                {t('login.title')}
              </h1>
              <p className="max-w-xl text-base leading-7 text-slate-600 dark:text-slate-300">
                {t('login.description')}
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FeatureCard
                icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
                title={t('login.hint')}
                description={t('about.support.tip')}
              />
              <FeatureCard
                icon={<LockKeyhole className="h-5 w-5" aria-hidden="true" />}
                title="Session protected"
                description={t('help.note')}
              />
            </div>
          </div>
        </div>

        <Card className="w-full overflow-hidden border-[rgba(24,16,13,0.08)] bg-white/90 shadow-[0_30px_80px_-42px_rgba(17,12,11,0.38)] backdrop-blur-xl">
          <CardHeader className="pb-4 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[1.35rem] bg-[linear-gradient(135deg,rgba(225,93,73,1),rgba(244,131,102,0.92),rgba(217,169,64,0.88))] text-lg font-bold text-white shadow-[0_20px_45px_-24px_rgba(225,93,73,0.65)]">
              GW
            </div>
            <CardTitle className="text-2xl tracking-[-0.02em]">{t('login.title')}</CardTitle>
            <CardDescription className="text-sm leading-6">{t('login.description')}</CardDescription>
          </CardHeader>

          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="username">{t('login.fields.username')}</Label>
                <Input
                  id="username"
                  value={form.username}
                  autoComplete="username"
                  autoFocus
                  onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
                  placeholder={t('login.fields.usernamePlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{t('login.fields.password')}</Label>
                <Input
                  id="password"
                  type="password"
                  value={form.password}
                  autoComplete="current-password"
                  onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                  placeholder={t('login.fields.passwordPlaceholder')}
                />
              </div>

              {formError || error ? (
                <div className="rounded-[1rem] border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {formError || error}
                </div>
              ) : null}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? t('common.actions.loading') : t('login.actions.submit')}
              </Button>
            </form>
          </CardContent>

          <CardFooter className="justify-center pt-2">
            <p className="text-center text-xs leading-6 text-muted-foreground">{t('login.hint')}</p>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}

function FeatureCard({ description, icon, title }: { description: string; icon: ReactNode; title: string }) {
  return (
    <div className="rounded-[1.35rem] border border-white/60 bg-white/72 px-5 py-5 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.25)] backdrop-blur">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">{icon}</div>
      <p className="mt-4 text-sm font-semibold text-slate-950 dark:text-slate-50">{title}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  )
}
