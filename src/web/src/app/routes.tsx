import { lazy } from 'react'
import type { LazyExoticComponent, ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, BarChart3, Cog, FileText, GitBranch, Key, Layers, LifeBuoy, Settings } from 'lucide-react'

const DashboardPage = lazy(() => import('@/pages/Dashboard'))
const LogsPage = lazy(() => import('@/pages/Logs'))
const EventsPage = lazy(() => import('@/pages/Events'))
const ModelManagementPage = lazy(() => import('@/pages/ModelManagement'))
const RoutingManagementPage = lazy(() => import('@/pages/RoutingManagement'))
const ApiKeysPage = lazy(() => import('@/pages/ApiKeys'))
const SettingsPage = lazy(() => import('@/pages/Settings'))
const AboutPage = lazy(() => import('@/pages/About'))
const HelpPage = lazy(() => import('@/pages/Help'))
const LoginPage = lazy(() => import('@/pages/Login'))

interface AppRouteNavMeta {
  icon: LucideIcon
  labelKey: string
  titleKey?: string
  descriptionKey: string
  matchPaths?: string[]
}

export interface AppRouteDefinition {
  path: string
  element: LazyExoticComponent<ComponentType>
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
    path: '/models',
    element: ModelManagementPage,
    nav: {
      icon: Layers,
      labelKey: 'nav.models',
      titleKey: 'providers.title',
      descriptionKey: 'providers.description',
      matchPaths: ['/models', '/providers']
    }
  },
  {
    path: '/providers',
    element: ModelManagementPage
  },
  {
    path: '/routing',
    element: RoutingManagementPage,
    nav: {
      icon: GitBranch,
      labelKey: 'nav.routing',
      titleKey: 'routingManagement.title',
      descriptionKey: 'routingManagement.description'
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
