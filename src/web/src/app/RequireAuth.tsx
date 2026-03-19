import type { JSX } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Loader } from '@/components/Loader'
import { useAuth } from '@/providers/AuthProvider'

export function RequireAuth({ children }: { children: JSX.Element }) {
  const { authEnabled, isAuthenticated, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <Loader />
  }

  if (!authEnabled || isAuthenticated) {
    return children
  }

  return <Navigate to="/login" replace state={{ from: location }} />
}
