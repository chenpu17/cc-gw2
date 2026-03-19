import { Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
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

export function AppRouter() {
  return (
    <BrowserRouter basename={getRouterBasename()}>
      <Suspense fallback={<Loader />}>
        <Routes>
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
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
