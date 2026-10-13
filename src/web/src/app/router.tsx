import { Suspense, useMemo } from 'react'
import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Route,
  RouterProvider
} from 'react-router-dom'
import { Loader } from '@/components/Loader'
import { AppLayout } from '@/layouts/AppLayout'
import { protectedAppRoutes, publicAppRoutes, getRouterBasename } from './routes'
import { RequireAuth } from './RequireAuth'

function ProtectedAppFrame() {
  return (
    <RequireAuth>
      <AppLayout />
    </RequireAuth>
  )
}

/**
 * Data router (createBrowserRouter) rather than `<BrowserRouter>` —
 * `useBlocker` (unsaved-draft route-leave guards, provider workbench) only
 * exists on data routers. The route tree is the same JSX via
 * createRoutesFromElements; no loaders are used.
 */
export function AppRouter() {
  const router = useMemo(
    () =>
      createBrowserRouter(
        createRoutesFromElements(
          <>
            <Route path="/" element={<ProtectedAppFrame />}>
              {protectedAppRoutes.map((route) => {
                const Component = route.element
                if (route.index) {
                  return <Route key="index" index element={<Component />} />
                }

                return (
                  <Route
                    key={route.path}
                    path={route.path.slice(1)}
                    element={<Component />}
                  />
                )
              })}
            </Route>
            {publicAppRoutes.map((route) => {
              const Component = route.element
              return <Route key={route.path} path={route.path} element={<Component />} />
            })}
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        ),
        { basename: getRouterBasename() }
      ),
    []
  )
  return (
    <Suspense fallback={<Loader />}>
      <RouterProvider router={router} />
    </Suspense>
  )
}
