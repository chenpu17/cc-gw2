import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal } from 'lucide-react'
import { getActiveNavigationRoute, navigationRoutes } from '@/app/routes'
import { ThemeSwitcher } from '@/components/ThemeSwitcher'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useAuth } from '@/providers/AuthProvider'
import { BrandMark } from '@/components/BrandMark'

function isNavigationItemActive(pathname: string, item: (typeof navigationRoutes)[number]) {
  const matchPaths = item.nav.matchPaths ?? [item.path]
  return matchPaths.some((matchPath) => {
    if (matchPath === '/') return pathname === '/'
    return pathname.startsWith(matchPath)
  })
}

const navGroups: { labelKey: string; paths: readonly string[] }[] = [
  { labelKey: 'nav.group.overview', paths: ['/', '/logs', '/events'] },
  { labelKey: 'nav.group.configure', paths: ['/providers', '/api-keys'] },
  { labelKey: 'nav.group.system', paths: ['/settings', '/about'] }
]

/** mobile bottom tab bar: the four core destinations + a "more" drawer entry */
const mobileTabPaths = ['/', '/logs', '/providers', '/api-keys']

function groupLabelKeyForPath(pathname: string): string {
  for (const group of navGroups) {
    const hit = navigationRoutes.some(
      (route) => group.paths.includes(route.path) && isNavigationItemActive(pathname, route)
    )
    if (hit) return group.labelKey
  }
  return navGroups[0].labelKey
}

function GatewayBrandMark({ compact }: { compact?: boolean }) {
  return (
    <BrandMark
      className={cn(compact ? 'h-8 w-8' : 'h-9 w-9')}
      title="cc-gw"
    />
  )
}

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
        <p className="mb-1 px-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
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
                    'relative mx-1 flex items-center justify-center rounded-lg p-2 transition-colors',
                    isActive
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  )}
                  aria-label={label}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 origin-left rounded-full bg-primary motion-surface',
                      isActive ? 'scale-x-100' : 'scale-x-0'
                    )}
                  />
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
              'relative mx-2 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            )}
          >
            <span
              aria-hidden
              className={cn(
                'absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 origin-left rounded-full bg-primary motion-surface',
                isActive ? 'scale-x-100' : 'scale-x-0'
              )}
            />
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1 truncate">{label}</span>
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

  return (
    <div className={cn('flex h-full flex-col', compact ? 'items-center' : '')}>
      {/* Logo */}
      <div className={cn(
        'flex shrink-0 items-center border-b border-[color:var(--surface-border)]',
        compact ? 'h-12 w-full justify-center' : 'h-12 gap-3 px-4'
      )}>
        <GatewayBrandMark compact={compact} />
        {!compact && (
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <p className="shrink-0 whitespace-nowrap text-sm font-semibold text-foreground" title={t('app.title')}>
                cc-gw
              </p>
              <span className="ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-success-bg px-1.5 py-0.5 text-[10px] font-medium text-success before:h-1.5 before:w-1.5 before:rounded-full before:bg-success">
                {t('app.online')}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Nav */}
      <div className={cn('flex-1 overflow-y-auto', compact ? 'w-full p-2' : 'space-y-4 p-3')}>
        {compact ? (
          <TooltipProvider delayDuration={0}>
            <div className="space-y-1">
              {navGroups.map((group, index) => (
                <div key={group.labelKey}>
                  {index > 0 && <div className="my-2 border-t border-border" />}
                  <NavGroup
                    label=""
                    items={navigationRoutes.filter((r) => group.paths.includes(r.path))}
                    pathname={location.pathname}
                    compact
                    onNavigate={onNavigate}
                  />
                </div>
              ))}
            </div>
          </TooltipProvider>
        ) : (
          <>
            {navGroups.map((group) => (
              <NavGroup
                key={group.labelKey}
                label={t(group.labelKey)}
                items={navigationRoutes.filter((r) => group.paths.includes(r.path))}
                pathname={location.pathname}
                onNavigate={onNavigate}
              />
            ))}
          </>
        )}
      </div>

      {/* User footer */}
      {authEnabled && username && !compact && (
        <div className="shrink-0 border-t border-border p-3">
          <div className="flex items-center gap-2 rounded-lg px-2 py-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-medium text-muted-foreground">
              {username.slice(0, 2).toUpperCase()}
            </div>
            <span className="flex-1 truncate text-xs text-muted-foreground">{username}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function MobileTabBar({ onMore }: { onMore: () => void }) {
  const { t } = useTranslation()
  const location = useLocation()
  const tabs = navigationRoutes.filter((r) => mobileTabPaths.includes(r.path))

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex h-14 items-stretch border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label={t('nav.more')}
    >
      {tabs.map((item) => {
        const Icon = item.nav.icon
        const isActive = isNavigationItemActive(location.pathname, item)
        return (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
              isActive ? 'text-primary' : 'text-muted-foreground'
            )}
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            <span className="truncate">{t(item.nav.labelKey)}</span>
          </NavLink>
        )
      })}
      <button
        type="button"
        onClick={onMore}
        className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-muted-foreground transition-colors"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
        <span>{t('nav.more')}</span>
      </button>
    </nav>
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
  const activeTitle = t(activeItem.nav.titleKey ?? activeItem.nav.labelKey)
  const groupLabel = t(groupLabelKeyForPath(location.pathname))

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
      <aside className="hidden w-14 shrink-0 flex-col bg-card md:flex lg:hidden">
        <SidebarContent compact />
      </aside>

      {/* Full sidebar (lg+) */}
      <aside className="hidden w-52 shrink-0 flex-col bg-card lg:flex">
        <SidebarContent />
      </aside>

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/95 px-4 backdrop-blur-sm lg:px-6">
          <div key={location.pathname} className="flex min-w-0 animate-fade-in items-baseline gap-2">
            <span className="hidden shrink-0 text-xs text-muted-foreground/60 sm:inline">{groupLabel}</span>
            <span aria-hidden className="hidden shrink-0 text-xs text-muted-foreground/40 sm:inline">/</span>
            <h1 className="truncate text-sm font-semibold text-foreground">{activeTitle}</h1>
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
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-20 pt-4 md:pb-4 lg:px-6">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <MobileTabBar onMore={() => setMobileNavOpen(true)} />

      {/* Mobile "more" drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <div
            className="fixed inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setMobileNavOpen(false)}
          />
          <div
            id="mobile-nav"
            className="fixed inset-y-0 left-0 w-52 bg-card shadow-[var(--surface-shadow-lg)] animate-in slide-in-from-left duration-200"
          >
            <SidebarContent onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </div>
      )}
    </div>
  )
}
