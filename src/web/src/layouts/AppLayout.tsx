import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Menu, X, ChevronRight } from 'lucide-react'
import { getActiveNavigationRoute, navigationRoutes } from '@/app/routes'
import { ThemeSwitcher } from '@/components/ThemeSwitcher'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useAuth } from '@/providers/AuthProvider'

function isNavigationItemActive(pathname: string, item: (typeof navigationRoutes)[number]) {
  const matchPaths = item.nav.matchPaths ?? [item.path]
  return matchPaths.some((matchPath) => {
    if (matchPath === '/') return pathname === '/'
    return pathname.startsWith(matchPath)
  })
}

const overviewPaths = ['/', '/logs', '/models', '/events', '/profiler']
const adminPaths = ['/api-keys', '/settings', '/help', '/about']

function NavGroup({
  label,
  items,
  pathname,
  compact,
  onNavigate,
}: {
  label: string
  items: typeof navigationRoutes
  pathname: string
  compact?: boolean
  onNavigate?: () => void
}) {
  const { t } = useTranslation()
  if (items.length === 0) return null
  return (
    <div className="space-y-0.5">
      {!compact && (
        <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
          {label}
        </p>
      )}
      {items.map((item) => {
        const Icon = item.nav.icon
        const isActive = isNavigationItemActive(pathname, item)
        const label = t(item.nav.labelKey)
        if (compact) {
          return (
            <Tooltip key={item.path}>
              <TooltipTrigger asChild>
                <NavLink
                  to={item.path}
                  onClick={onNavigate}
                  end={item.path === '/'}
                  className={cn(
                    'flex items-center justify-center rounded-full p-2.5 transition-colors',
                    isActive
                      ? 'bg-accent text-primary'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  )}
                  aria-label={label}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </NavLink>
              </TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          )
        }
        return (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onNavigate}
            end={item.path === '/'}
            className={cn(
              'flex items-center gap-3 rounded-full px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-accent text-primary'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1 truncate">{label}</span>
            {isActive && <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />}
          </NavLink>
        )
      })}
    </div>
  )
}

function SidebarContent({ compact, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const { t } = useTranslation()
  const location = useLocation()
  const { authEnabled, username } = useAuth()

  const overviewItems = navigationRoutes.filter((r) => overviewPaths.includes(r.path))
  const adminItems = navigationRoutes.filter((r) => adminPaths.includes(r.path))

  return (
    <div className={cn('flex h-full flex-col', compact ? 'items-center' : '')}>
      {/* Logo */}
      <div className={cn(
        'flex shrink-0 items-center border-b border-border',
        compact ? 'h-16 w-full justify-center' : 'h-16 gap-3 px-5'
      )}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
          GW
        </div>
        {!compact && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{t('app.title')}</p>
            <p className="truncate text-xs text-muted-foreground">{t('app.consoleSubtitle')}</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <div className={cn('flex-1 overflow-y-auto', compact ? 'w-full p-2' : 'space-y-4 p-3')}>
        {compact ? (
          <TooltipProvider delayDuration={0}>
            <div className="space-y-1">
              <NavGroup label="" items={overviewItems} pathname={location.pathname} compact onNavigate={onNavigate} />
              <div className="my-2 border-t border-border" />
              <NavGroup label="" items={adminItems} pathname={location.pathname} compact onNavigate={onNavigate} />
            </div>
          </TooltipProvider>
        ) : (
          <>
            <NavGroup label={t('nav.group.overview')} items={overviewItems} pathname={location.pathname} onNavigate={onNavigate} />
            <NavGroup label={t('nav.group.admin')} items={adminItems} pathname={location.pathname} onNavigate={onNavigate} />
          </>
        )}
      </div>

      {/* User footer */}
      {authEnabled && username && !compact && (
        <div className="shrink-0 border-t border-border p-3">
          <div className="flex items-center gap-2 rounded-lg px-2 py-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-muted-foreground">
              {username.slice(0, 2).toUpperCase()}
            </div>
            <span className="flex-1 truncate text-xs text-muted-foreground">{username}</span>
          </div>
        </div>
      )}
    </div>
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

  const activeItem = useMemo(() => getActiveNavigationRoute(location.pathname), [location.pathname])
  const activeTitle = t(activeItem.nav.labelKey)
  const activeDescription = t(activeItem.nav.descriptionKey)

  const handleLogout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try { await logout() } finally { setLoggingOut(false) }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-4 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        {t('app.skipToContent')}
      </a>

      {/* Compact sidebar (md–lg) */}
      <aside className="hidden w-16 shrink-0 flex-col border-r border-border bg-card md:flex lg:hidden">
        <SidebarContent compact />
      </aside>

      {/* Full sidebar (lg+) */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card lg:flex">
        <SidebarContent />
      </aside>

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4 lg:px-6">
          <div className="flex items-center gap-3">
            {/* Mobile menu button */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileNavOpen((prev) => !prev)}
              aria-label={mobileNavOpen ? t('common.actions.closeNavigation') : t('common.actions.openNavigation')}
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-nav"
            >
              {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
            <div>
              <p className="text-sm font-semibold text-foreground">{activeTitle}</p>
              <p className="hidden text-xs text-muted-foreground sm:block">{activeDescription}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {authEnabled && username && (
              <span className="hidden text-xs text-muted-foreground sm:inline">
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

        {/* Page content */}
        <main
          id="main-content"
          role="main"
          tabIndex={-1}
          className="flex-1 overflow-y-auto"
        >
          <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile nav overlay */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <div
            className="fixed inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setMobileNavOpen(false)}
          />
          <div
            id="mobile-nav"
            className="fixed inset-y-0 left-0 w-64 border-r border-border bg-card shadow-lg animate-in slide-in-from-left duration-200"
          >
            <SidebarContent onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </div>
      )}
    </div>
  )
}
