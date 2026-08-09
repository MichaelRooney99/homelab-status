import { useQuery } from '@tanstack/react-query'
import { fetchAllServices } from '../services'
import type { StatusPage } from '../services/types'

export function useServiceStatus() {
  const { data, isLoading, isError } = useQuery<StatusPage>({
    queryKey: ['serviceStatus'],
    queryFn: fetchAllServices,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    retry: 2,
    staleTime: 55_000,
  })

  return {
    statusPage: data,
    isLoading,
    isError,
  }
}
