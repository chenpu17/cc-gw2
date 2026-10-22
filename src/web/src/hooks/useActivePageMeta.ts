import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getActiveNavigationRoute } from '@/app/routes'

export interface ActivePageMeta {
  title: string
  description: string
}

/**
 * Title + one-line description of the active route, sourced from the route
 * table (`app/routes.ts`) so a page cannot ship without them.
 *
 * `PageToolbar` consumes this to render the page's single `<h1>`; the global
 * header only carries a muted breadcrumb, so every screen has exactly one
 * heading anchor.
 */
export function useActivePageMeta(): ActivePageMeta {
  const { t } = useTranslation()
  const location = useLocation()
  const nav = getActiveNavigationRoute(location.pathname)?.nav

  const title = nav ? t(nav.titleKey ?? nav.labelKey) : ''
  // Keep the tab title in sync with the route (and the active locale) so
  // multiple tabs and browser history entries are distinguishable.
  useEffect(() => {
    document.title = title ? `${title} · cc-gw` : 'cc-gw'
  }, [title])

  return {
    title,
    description: nav?.descriptionKey ? t(nav.descriptionKey) : ''
  }
}
