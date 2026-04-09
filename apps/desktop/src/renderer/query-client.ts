import { QueryClient } from '@tanstack/react-query'

export function createRendererQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
      queries: {
        refetchOnWindowFocus: false,
        retry: false,
      },
    },
  })
}

export const rendererQueryClient = createRendererQueryClient()
