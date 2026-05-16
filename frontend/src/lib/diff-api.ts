import { useEffect, useState } from 'react'
import { API_ORIGIN } from '#/lib/apollo'

export interface DiffState {
  patch: string
  loading: boolean
  error: Error | null
}

export function diffUrl(rev: string, path?: string): string {
  const params = new URLSearchParams({ rev })
  if (path) params.set('path', path)
  return `${API_ORIGIN}/api/diff?${params.toString()}`
}

export function useDiff(rev: string, refreshKey: number = 0): DiffState {
  const [state, setState] = useState<DiffState>({ patch: '', loading: true, error: null })

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    fetch(diffUrl(rev))
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
        return r.text()
      })
      .then((text) => {
        if (cancelled) return
        setState({ patch: text, loading: false, error: null })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setState({ patch: '', loading: false, error: err instanceof Error ? err : new Error(String(err)) })
      })
    return () => {
      cancelled = true
    }
  }, [rev, refreshKey])

  return state
}
