import { useEffect, useRef, useState } from 'react'
import { API_ORIGIN } from '#/lib/apollo'

export interface DiffState {
  patch: string
  loading: boolean
  error: Error | null
}

export function diffUrl(rev: string, path?: string, repo?: string): string {
  const params = new URLSearchParams({ rev })
  if (path) params.set('path', path)
  if (repo) params.set('repo', repo)
  return `${API_ORIGIN}/api/diff?${params.toString()}`
}

export function useDiff(
  rev: string,
  refreshKey: number = 0,
  path?: string,
  initial?: string,
  repo?: string,
): DiffState {
  const [state, setState] = useState<DiffState>(() =>
    initial !== undefined
      ? { patch: initial, loading: false, error: null }
      : { patch: '', loading: true, error: null },
  )
  const skipNextFetch = useRef(initial !== undefined && refreshKey === 0)

  useEffect(() => {
    if (skipNextFetch.current) {
      skipNextFetch.current = false
      return
    }
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    fetch(diffUrl(rev, path, repo))
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
  }, [rev, refreshKey, path, repo])

  return state
}
