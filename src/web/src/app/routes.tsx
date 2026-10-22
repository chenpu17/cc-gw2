import { lazy } from 'react'
import type { LazyExoticComponent, ComponentType } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, BarChart3, Cog, FileText, Key, Layers, LifeBuoy, Route, Settings } from 'lucide-react'

const DashboardPage = lazy(() => import('@/pages/Dashboard'))
const LogsPage = lazy(() => import('@/pages/Logs'))
const EventsPage = lazy(() => import('@/pages/Events'))
const ProvidersPage = lazy(() => import('@/pages/ProvidersPage'))
const RoutingPage = lazy(() => import('@/pages/RoutingPage'))
const ApiKeysPage = lazy(() => import('@/pages/ApiKeys'))
const SettingsPage = lazy(() => import('@/pages/Settings'))
const SetupPage = lazy(() => import('@/pages/Setup'))
const AboutPage = lazy(() => import('@/pages/About'))
const HelpPage = lazy(() => import('@/pages/Help'))
const LoginPage = lazy(() => import('@/pages/Login'))

function RedirectToProviders() {
  return <Navigate to="/providers" replace />
}

/**
 * Compat shim for the old combined workbench URL: `/providers?tab=routing`
 * (and its legacy `tab=endpoints` alias) now live at `/routing`, carrying the
 * selected endpoint over. Anything else renders the providers page.
 */
function ProvidersRouteCompat() {
  const [searchParams] = useSearchParams()
  const tab = searchParams.get('tab')
  if (tab === 'routing' || tab === 'endpoints') {
    const endpoint = searchParams.get('endpoint')
    return <Navigate to={endpoint ? `/routing?endpoint=${encodeURIComponent(endpoint)}` : '/routing'} replace />
  }
  return <ProvidersPage />
}

interface AppRouteNavMeta {
  icon: LucideIcon
  labelKey: string
  titleKey?: string
  descriptionKey: string
  matchPaths?: string[]
}

export interface AppRouteDefinition {
  path: string
  element: LazyExoticComponent<ComponentType> | ComponentType
  index?: boolean
  nav?: AppRouteNavMeta
}

export const protectedAppRoutes: AppRouteDefinition[] = [
  {
    path: '/',
    index: true,
    element: DashboardPage,
    nav: {
      icon: BarChart3,
      labelKey: 'nav.dashboard',
      titleKey: 'nav.dashboard',
      descriptionKey: 'dashboard.description',
      matchPaths: ['/']
    }
  },
  {
    path: '/logs',
    element: LogsPage,
    nav: {
      icon: FileText,
      labelKey: 'nav.logs',
      titleKey: 'logs.title',
      descriptionKey: 'logs.description'
    }
  },
  {
    path: '/providers',
    element: ProvidersRouteCompat,
    nav: {
      icon: Layers,
      labelKey: 'nav.providers',
      titleKey: 'providers.title',
      descriptionKey: 'providers.description',
      matchPaths: ['/providers', '/models']
    }
  },
  {
    path: '/models',
    element: RedirectToProviders
  },
  {
    path: '/routing',
    element: RoutingPage,
    nav: {
      icon: Route,
      labelKey: 'nav.routing',
      titleKey: 'workbench.routingTitle',
      descriptionKey: 'workbench.routingDescription'
    }
  },
  {
    path: '/events',
    element: EventsPage,
    nav: {
      icon: AlertTriangle,
      labelKey: 'nav.events',
      titleKey: 'events.title',
      descriptionKey: 'events.description'
    }
  },
  {
    path: '/api-keys',
    element: ApiKeysPage,
    nav: {
      icon: Key,
      labelKey: 'nav.apiKeys',
      titleKey: 'apiKeys.title',
      descriptionKey: 'apiKeys.description'
    }
  },
  {
    path: '/setup',
    element: SetupPage
  },
  {
    path: '/settings',
    element: SettingsPage,
    nav: {
      icon: Settings,
      labelKey: 'nav.settings',
      titleKey: 'settings.title',
      descriptionKey: 'settings.description'
    }
  },
  {
    path: '/help',
    element: HelpPage,
    nav: {
      icon: LifeBuoy,
      labelKey: 'nav.help',
      titleKey: 'help.title',
      descriptionKey: 'help.intro'
    }
  },
  {
    path: '/about',
    element: AboutPage,
    nav: {
      icon: Cog,
      labelKey: 'nav.about',
      titleKey: 'about.title',
      descriptionKey: 'about.description'
    }
  }
]

export const publicAppRoutes: AppRouteDefinition[] = [
  {
    path: '/login',
    element: LoginPage
  }
]

export const navigationRoutes = protectedAppRoutes.filter(
  (route): route is AppRouteDefinition & { nav: AppRouteNavMeta } => Boolean(route.nav)
)

export interface NavGroupDef {
  labelKey: string
  paths: readonly string[]
}

/**
 * Sidebar + command-palette grouping of nav routes. Every routable page must
 * appear in one group: ungrouped pages are URL-only, which left /help with no
 * discoverable entry at all.
 */
export const navGroups: NavGroupDef[] = [
  { labelKey: 'nav.group.overview', paths: ['/', '/logs', '/events'] },
  { labelKey: 'nav.group.configure', paths: ['/providers', '/routing', '/api-keys'] },
  { labelKey: 'nav.group.system', paths: ['/settings', '/help', '/about'] }
]

export function getActiveNavigationRoute(pathname: string) {
  if (pathname === '/') {
    return navigationRoutes[0]
  }

  return (
    navigationRoutes.find((route) => {
      const matchPaths = route.nav.matchPaths ?? [route.path]
      return matchPaths.some((matchPath) => matchPath !== '/' && pathname.startsWith(matchPath))
    }) ?? navigationRoutes[0]
  )
}

export function getRouterBasename() {
  if (typeof window === 'undefined') {
    return '/'
  }

  return window.location.pathname.startsWith('/ui') ? '/ui' : '/'
}
