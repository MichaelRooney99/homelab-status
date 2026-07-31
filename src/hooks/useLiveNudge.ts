import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

const PROXY_URL = import.meta.env.VITE_PROXY_URL ?? 'http://localhost:3001'

// The hybrid half of 17-'s SSE feature — this app still polls for its
// actual data every 60s via useServiceStatus's own refetchInterval.
// This hook never carries state and never replaces that polling; its
// only job is telling the existing query "something changed, refetch
// now" sooner than the next scheduled tick. Deliberately kept this way
// rather than having the nudge event carry the new StatusPage directly
// — that would mean relocating the whole client-side aggregation facade
// (services/index.ts) server-side, the "full SSE" option 17- explicitly
// recommended against for the size of win it buys here. The 60s poll
// staying intact is also the fallback for a dropped or never-established
// SSE connection — the page degrades to exactly today's behavior, not
// to nothing.
export function useLiveNudge(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    const source = new EventSource(`${PROXY_URL}/events`)

    source.addEventListener('nudge', () => {
      queryClient.invalidateQueries({ queryKey: ['serviceStatus'] })
    })

    // EventSource reconnects automatically on its own after a dropped
    // connection — nothing to do here beyond not letting a connection
    // error surface as an unhandled console error for something that's
    // expected to recover by itself.
    source.onerror = () => {}

    return () => source.close()
  }, [queryClient])
}