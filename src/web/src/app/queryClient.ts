import { QueryClient } from '@tanstack/react-query'
import type { ApiError } from '@/services/api'

function shouldRetry(failureCount: number, error: unknown) {
  const apiError = error as ApiError | undefined
  const status = apiError?.status

  if (status === 401 || status === 403 || status === 404) {
    return false
  }

  return failureCount < 2
}

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: 30_000,
        refetchOnWindowFocus: false
      },
      mutations: {
        retry: false
      }
    }
  })
}
