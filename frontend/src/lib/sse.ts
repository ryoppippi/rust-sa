import { useEffect, useRef } from 'react'
import { getApiOrigin, isTauri } from '#/lib/apollo'

export function useEvents(repo: string, onMessage: () => void, debounceMs = 800) {
  const ref = useRef(onMessage)
  ref.current = onMessage

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!repo) return
    let cancelled = false
    let timer = 0
    const schedule = () => {
      if (timer !== 0) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = 0
        if (!cancelled) ref.current()
      }, debounceMs)
    }

    if (isTauri()) {
      ;(async () => {
        const { Channel, invoke } = await import('@tauri-apps/api/core')
        if (cancelled) return
        const channel = new Channel<string>()
        channel.onmessage = () => schedule()
        try {
          await invoke('subscribe_events', { repo, channel })
        } catch (err) {
          console.error('subscribe_events failed', err)
        }
      })()
      return () => {
        cancelled = true
        if (timer !== 0) window.clearTimeout(timer)
      }
    }

    const url = `${getApiOrigin()}/api/events?repo=${encodeURIComponent(repo)}`
    const es = new EventSource(url)
    es.onmessage = () => schedule()
    return () => {
      cancelled = true
      if (timer !== 0) window.clearTimeout(timer)
      es.close()
    }
  }, [repo, debounceMs])
}
