import { lazy } from 'react'
import type { LazyExoticComponent, ComponentType } from 'react'
import { Navigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, BarChart3, Cog, FileText, Key, LifeBuoy, Route, Settings } from 'lucide-react'

const DashboardPage = lazy(() => import('@/pages/Dashboard'))
const LogsPage = lazy(() => import('@/pages/Logs'))
const EventsPage = lazy(() => import('@/pages/Events'))
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

// Interim shim: /providers lands on the (new) routing page until the split
// providers page lands in the next commit. Never reachable as a final state.
function RedirectToRouting() {
  return <Navigate to="/routing" replace />
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
    element: RedirectToRouting
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
 * Sidebar + command-palette grouping of nav routes. Routes outside any group
 * (e.g. /help) are reachable by URL only, consistent across both surfaces.
 */
export const navGroups: NavGroupDef[] = [
  { labelKey: 'nav.group.overview', paths: ['/', '/logs', '/events'] },
  { labelKey: 'nav.group.configure', paths: ['/providers', '/api-keys'] },
  { labelKey: 'nav.group.system', paths: ['/settings', '/about'] }
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
