import { lazy } from 'react'
import type { LazyExoticComponent, ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Activity, AlertTriangle, BarChart3, Cog, FileText, Key, Layers, LifeBuoy, Settings } from 'lucide-react'

const DashboardPage = lazy(() => import('@/pages/Dashboard'))
const LogsPage = lazy(() => import('@/pages/Logs'))
const EventsPage = lazy(() => import('@/pages/Events'))
const ModelManagementPage = lazy(() => import('@/pages/ModelManagement'))
const ApiKeysPage = lazy(() => import('@/pages/ApiKeys'))
const SettingsPage = lazy(() => import('@/pages/Settings'))
const AboutPage = lazy(() => import('@/pages/About'))
const HelpPage = lazy(() => import('@/pages/Help'))
const LoginPage = lazy(() => import('@/pages/Login'))
const ProfilerPage = lazy(() => import('@/pages/Profiler'))

interface AppRouteNavMeta {
  icon: LucideIcon
  labelKey: string
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
      descriptionKey: 'logs.description'
    }
  },
  {
    path: '/models',
    element: ModelManagementPage,
    nav: {
      icon: Layers,
      labelKey: 'nav.models',
      descriptionKey: 'modelManagement.description',
      matchPaths: ['/models', '/providers']
    }
  },
  {
    path: '/providers',
    element: ModelManagementPage
  },
  {
    path: '/events',
    element: EventsPage,
    nav: {
      icon: AlertTriangle,
      labelKey: 'nav.events',
      descriptionKey: 'events.description'
    }
  },
  {
    path: '/api-keys',
    element: ApiKeysPage,
    nav: {
      icon: Key,
      labelKey: 'nav.apiKeys',
      descriptionKey: 'apiKeys.description'
    }
  },
  {
    path: '/profiler',
    element: ProfilerPage,
    nav: {
      icon: Activity,
      labelKey: 'nav.profiler',
      descriptionKey: 'profiler.description'
    }
  },
  {
    path: '/settings',
    element: SettingsPage,
    nav: {
      icon: Settings,
      labelKey: 'nav.settings',
      descriptionKey: 'settings.description'
    }
  },
  {
    path: '/help',
    element: HelpPage,
    nav: {
      icon: LifeBuoy,
      labelKey: 'nav.help',
      descriptionKey: 'help.intro'
    }
  },
  {
    path: '/about',
    element: AboutPage,
    nav: {
      icon: Cog,
      labelKey: 'nav.about',
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
