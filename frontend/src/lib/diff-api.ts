import { useEffect, useRef, useState } from 'react'
import { getApiOrigin, isTauri } from '#/lib/apollo'

export interface DiffState {
  patch: string
  loading: boolean
  error: Error | null
}

async function fetchDiff(
  rev: string,
  repo: string,
  path?: string,
  w?: boolean,
  patch?: string,
): Promise<string> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<string>('diff', {
      rev,
      repo,
      path: path ?? null,
      w: w ?? false,
    })
  }
  const params = new URLSearchParams({ rev })
  if (repo) params.set('repo', repo)
  if (patch) params.set('patch', patch)
  if (path) params.set('path', path)
  if (w) params.set('w', '1')
  const url = `${getApiOrigin()}/api/diff?${params.toString()}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.text()
}

interface RevPair {
  base: string
  head: string
}

function isSpecialRev(rev: string): boolean {
  const u = rev.toUpperCase()
  return u === 'WORKING' || u === 'STAGING' || u === 'STDIN'
}

function resolveRevPair(rev: string): RevPair | null {
  if (isSpecialRev(rev)) return null
  const tripleIdx = rev.indexOf('...')
  if (tripleIdx >= 0) {
    // triple-dot requires merge-base resolution; defer to patch fallback.
    return null
  }
  const doubleIdx = rev.indexOf('..')
  if (doubleIdx >= 0) {
    const base = rev.slice(0, doubleIdx)
    const head = rev.slice(doubleIdx + 2)
    if (isSpecialRev(base) || isSpecialRev(head)) return null
    return { base, head }
  }
  return { base: `${rev}^`, head: rev }
}

async function fetchBlob(rev: string, repo: string, path: string): Promise<string | null> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    try {
      return await invoke<string>('blob', { rev, repo, path })
    } catch {
      return null
    }
  }
  const params = new URLSearchParams({ rev, repo, path })
  const url = `${getApiOrigin()}/api/blob?${params.toString()}`
  const r = await fetch(url)
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.text()
}

export interface FileBlobsState {
  oldText: string | null
  newText: string | null
  available: boolean
  loading: boolean
  error: Error | null
}

export function useFileBlobs(
  rev: string,
  repo: string,
  path: string | undefined,
  refreshKey: number = 0,
  patch?: string,
  enabled = true,
): FileBlobsState {
  const [state, setState] = useState<FileBlobsState>({
    oldText: null,
    newText: null,
    available: false,
    loading: true,
    error: null,
  })

  useEffect(() => {
    if (!enabled) {
      setState((s) => ({ ...s, loading: false, error: null }))
      return
    }
    const pair = path && !patch ? resolveRevPair(rev) : null
    if (!pair || !path) {
      setState({
        oldText: null,
        newText: null,
        available: false,
        loading: false,
        error: null,
      })
      return
    }
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    Promise.all([fetchBlob(pair.base, repo, path), fetchBlob(pair.head, repo, path)])
      .then(([oldText, newText]) => {
        if (cancelled) return
        setState({
          oldText,
          newText,
          available: true,
          loading: false,
          error: null,
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setState({
          oldText: null,
          newText: null,
          available: false,
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        })
      })
    return () => {
      cancelled = true
    }
  }, [rev, repo, refreshKey, path, patch, enabled])

  return state
}

export function useDiff(
  rev: string,
  repo: string,
  refreshKey: number = 0,
  path?: string,
  initial?: string,
  w?: boolean,
  patch?: string,
  enabled = true,
): DiffState {
  const [state, setState] = useState<DiffState>(() =>
    initial !== undefined
      ? { patch: initial, loading: false, error: null }
      : { patch: '', loading: true, error: null },
  )
  const skipNextFetch = useRef(initial !== undefined && refreshKey === 0)

  useEffect(() => {
    if (!enabled) {
      setState((s) => ({ ...s, loading: false, error: null }))
      return
    }
    if (skipNextFetch.current) {
      skipNextFetch.current = false
      return
    }
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    fetchDiff(rev, repo, path, w, patch)
      .then((text) => {
        if (cancelled) return
        setState({ patch: text, loading: false, error: null })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setState({
          patch: '',
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        })
      })
    return () => {
      cancelled = true
    }
  }, [rev, repo, refreshKey, path, w, patch, enabled])

  return state
}
