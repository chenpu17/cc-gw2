import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, BarChart3, Cog, FileText, Key, Layers, LifeBuoy, Menu, Settings, X } from 'lucide-react'
import { ThemeSwitcher } from '@/components/ThemeSwitcher'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useAuth } from '@/providers/AuthProvider'

const navItems = [
  { to: '/', icon: BarChart3, labelKey: 'nav.dashboard', descriptionKey: 'dashboard.description' },
  { to: '/logs', icon: FileText, labelKey: 'nav.logs', descriptionKey: 'logs.description' },
  { to: '/models', icon: Layers, labelKey: 'nav.models', descriptionKey: 'modelManagement.description' },
  { to: '/events', icon: AlertTriangle, labelKey: 'nav.events', descriptionKey: 'events.description' },
  { to: '/api-keys', icon: Key, labelKey: 'nav.apiKeys', descriptionKey: 'apiKeys.description' },
  { to: '/settings', icon: Settings, labelKey: 'nav.settings', descriptionKey: 'settings.description' },
  { to: '/help', icon: LifeBuoy, labelKey: 'nav.help', descriptionKey: 'help.intro' },
  { to: '/about', icon: Cog, labelKey: 'nav.about', descriptionKey: 'about.description' }
]

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation()

  return (
    <nav className="flex h-full flex-col gap-1" aria-label={t('app.title')}>
      {navItems.map((item) => {
        const Icon = item.icon
        return (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-primary/10 text-primary shadow-[inset_0_0_0_1px_rgba(59,130,246,0.08)]'
                  : 'text-muted-foreground hover:bg-background/80 hover:text-foreground'
              )
            }
            end={item.to === '/'}
            title={t(item.labelKey)}
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-primary" />
                )}
                <Icon className={cn('h-4 w-4 transition-colors', isActive ? 'text-primary' : '')} aria-hidden="true" />
                <span>{t(item.labelKey)}</span>
              </>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}

function SidebarNavCompact({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation()

  return (
    <TooltipProvider delayDuration={0}>
      <nav className="flex h-full flex-col gap-1" aria-label={t('app.title')}>
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <Tooltip key={item.to}>
              <TooltipTrigger asChild>
                <NavLink
                  to={item.to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex items-center justify-center rounded-lg p-2.5 transition-all duration-200',
                      isActive
                        ? 'bg-primary/10 text-primary shadow-[inset_0_0_0_1px_rgba(59,130,246,0.08)]'
                        : 'text-muted-foreground hover:bg-background/80 hover:text-foreground'
                    )
                  }
                  end={item.to === '/'}
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-primary" />
                      )}
                      <Icon className={cn('h-5 w-5', isActive ? 'text-primary' : '')} aria-hidden="true" />
                    </>
                  )}
                </NavLink>
              </TooltipTrigger>
              <TooltipContent side="right">
                {t(item.labelKey)}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </nav>
    </TooltipProvider>
  )
}

export function AppLayout() {
  const { t } = useTranslation()
  const location = useLocation()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { authEnabled, username, logout } = useAuth()
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  const activeItem = useMemo(() => {
    if (location.pathname === '/') {
      return navItems[0]
    }
    return navItems.find((item) => item.to !== '/' && location.pathname.startsWith(item.to)) ?? navItems[0]
  }, [location.pathname])

  const activeTitle = t(activeItem.labelKey)
  const activeDescription = t(activeItem.descriptionKey)
  const appTitle = t('app.title')

  const handleLogout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await logout()
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <div className="app-shell relative flex min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-4 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        {t('app.skipToContent')}
      </a>

      {/* Desktop Sidebar - Compact */}
      <aside className="hidden w-16 flex-col border-r border-white/40 bg-card/72 backdrop-blur-xl xl:hidden lg:flex">
        <div className="flex h-16 items-center justify-center border-b border-white/40">
          <div className="flex h-10 w-10 items-center justify-center rounded-[1.1rem] bg-gradient-to-br from-primary via-primary to-sky-400 text-xs font-bold text-primary-foreground shadow-[0_12px_28px_-18px_rgba(59,130,246,0.8)]">
            GW
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <SidebarNavCompact />
        </div>
      </aside>

      {/* Desktop Sidebar - Full */}
      <aside className="hidden w-64 flex-col border-r border-white/40 bg-card/72 backdrop-blur-xl xl:flex">
        <div className="flex h-20 items-center gap-3 border-b border-white/40 px-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-[1.1rem] bg-gradient-to-br from-primary via-primary to-sky-400 text-xs font-bold text-primary-foreground shadow-[0_12px_28px_-18px_rgba(59,130,246,0.8)]">
            GW
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-foreground">{t('app.title')}</p>
            <p className="text-xs text-muted-foreground">{t('app.consoleSubtitle')}</p>
          </div>
        </div>
        <div className="border-b border-white/40 px-5 py-4">
          <div className="rounded-[1.2rem] border border-white/50 bg-background/75 px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {t('app.environmentLabel')}
            </p>
            <div className="mt-2 flex items-center gap-2 text-sm font-medium">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {t('app.online')}
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <SidebarNav />
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between gap-4 border-b border-white/40 bg-background/78 px-4 backdrop-blur-xl lg:px-6">
          <div className="flex items-center gap-3 lg:hidden">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileNavOpen((prev) => !prev)}
              aria-label={mobileNavOpen ? t('common.actions.closeNavigation') : t('common.actions.openNavigation')}
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-nav"
            >
              {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
            <div>
              <p className="font-semibold tracking-[-0.01em]">{activeTitle}</p>
              <p className="text-xs text-muted-foreground">{activeDescription}</p>
            </div>
          </div>

          <div className="hidden min-w-0 flex-1 lg:block">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                <span>{appTitle}</span>
                <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />
                <span className="truncate text-foreground/85">{activeTitle}</span>
              </div>
              <p className="truncate text-sm text-muted-foreground">{activeDescription}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300 lg:inline-flex">
              {t('app.online')}
            </span>
            {authEnabled && username && (
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {t('login.status', { username })}
              </span>
            )}
            {authEnabled && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleLogout()}
                disabled={loggingOut}
              >
                {loggingOut ? t('common.actions.loading') : t('common.actions.logout')}
              </Button>
            )}
            <LanguageSwitcher />
            <ThemeSwitcher />
          </div>
        </header>

        {/* Main Content */}
        <main
          id="main-content"
          role="main"
          tabIndex={-1}
          className="flex-1 overflow-y-auto"
        >
          <div className="container mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile Navigation Overlay */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div
            className="fixed inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setMobileNavOpen(false)}
          />
          <div
            id="mobile-nav"
            className="fixed inset-y-0 left-0 w-72 border-r border-white/40 bg-card/95 p-6 shadow-lg backdrop-blur-xl animate-in slide-in-from-left"
          >
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="font-semibold">{t('app.title')}</p>
                <p className="text-xs text-muted-foreground">{t('app.consoleSubtitle')}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileNavOpen(false)}
                aria-label={t('common.actions.closeNavigation')}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </div>
      )}
    </div>
  )
}
