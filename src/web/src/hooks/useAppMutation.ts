import { useMutation, useQueryClient, type QueryKey, type UseMutationOptions } from '@tanstack/react-query'
import { toApiError, type ApiError } from '@/services/api'
import { useToast } from '@/providers/ToastProvider'

interface AppMutationOptions<TData, TVariables, TContext>
  extends Omit<UseMutationOptions<TData, ApiError, TVariables, TContext>, 'mutationFn'> {
  mutationFn: (variables: TVariables) => Promise<TData>
  successToast?: ((data: TData, variables: TVariables) => { title: string; description?: string } | null) | null
  errorToast?: ((error: ApiError, variables: TVariables) => { title: string; description?: string } | null) | null
  invalidateKeys?: QueryKey[]
}

export function useAppMutation<TData = void, TVariables = void, TContext = unknown>({
  mutationFn,
  successToast,
  errorToast,
  invalidateKeys,
  onSuccess,
  onError,
  ...options
}: AppMutationOptions<TData, TVariables, TContext>) {
  const queryClient = useQueryClient()
  const { pushToast } = useToast()

  return useMutation<TData, ApiError, TVariables, TContext>({
    ...options,
    mutationFn: async (variables) => {
      try {
        return await mutationFn(variables)
      } catch (error) {
        throw toApiError(error)
      }
    },
    onSuccess: async (data, variables, onMutateResult, context) => {
      if (invalidateKeys?.length) {
        await Promise.all(
          invalidateKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))
        )
      }

      const toast = successToast?.(data, variables)
      if (toast) {
        pushToast({ ...toast, variant: 'success' })
      }

      await onSuccess?.(data, variables, onMutateResult, context)
    },
    onError: async (error, variables, onMutateResult, context) => {
      const toast = errorToast?.(error, variables)
      if (toast) {
        pushToast({ ...toast, variant: 'error' })
      }

      await onError?.(error, variables, onMutateResult, context)
    }
  })
}
