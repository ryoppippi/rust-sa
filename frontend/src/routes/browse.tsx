import { useQuery } from '#/lib/typed-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { File, FileDiff, GitGraph } from 'lucide-react'
import { useEffect, useState } from 'react'
import { BrandMark } from '#/components/brand-mark'
import { FileTreeView } from '#/components/file-tree-view'
import { GitHubLink } from '#/components/github-link'
import { RefreshButton } from '#/components/ui/refresh-button'
import { ResizeHandle } from '#/components/ui/resize-handle'
import { TreeDocument } from '#/graphql/generated/graphql'
import { fetchBlob } from '#/lib/blob-cache'
import { highlightCode } from '#/lib/highlight'
import { usePreference, useRootAttribute } from '#/lib/preference'
import { useThemePreference } from '#/lib/server-preference'

interface BrowseSearch {
  repo?: string
  rev?: string
  path?: string
}

export const Route = createFileRoute('/browse')({
  validateSearch: (search: Record<string, unknown>): BrowseSearch => ({
    repo: typeof search.repo === 'string' ? search.repo : undefined,
    rev: typeof search.rev === 'string' ? search.rev : undefined,
    path: typeof search.path === 'string' ? search.path : undefined,
  }),
  loaderDeps: ({ search }) => ({ repo: search.repo, rev: search.rev }),
  loader: ({ deps }) => {
    if (!deps.repo) {
      throw new Error('?repo=<absolute-path> query parameter is required')
    }
    return { repo: deps.repo, rev: deps.rev ?? 'HEAD' }
  },
  component: BrowsePage,
})

function BrowsePage() {
  const navigate = useNavigate()
  const [theme] = useThemePreference()
  const [density] = usePreference<'compact' | 'regular' | 'comfy'>('rust-sa:density', 'regular')
  const [treeWStr, setTreeWStr] = usePreference<string>('rust-sa:browse-tree-w', '320')
  const treeW = Number(treeWStr) || 320
  useRootAttribute('data-theme', theme)
  useRootAttribute('data-density', density)

  const { repo, rev } = Route.useLoaderData()
  const search = Route.useSearch()
  const selectedPath = search.path

  const [manualRefreshing, setManualRefreshing] = useState(false)
  const [blobRefreshKey, setBlobRefreshKey] = useState(0)
  const { data, loading, error, refetch } = useQuery(TreeDocument, {
    variables: { repo, rev },
    notifyOnNetworkStatusChange: true,
  })
  const paths = data?.tree ?? []

  const onManualRefresh = async () => {
    if (manualRefreshing || loading) return
    setManualRefreshing(true)
    try {
      await refetch()
      setBlobRefreshKey((k) => k + 1)
    } finally {
      setManualRefreshing(false)
    }
  }

  const selectPath = (next: string) => {
    navigate({
      to: '/browse',
      search: (s) => ({ ...(s as BrowseSearch), path: next }),
      replace: true,
    })
  }

  return (
    <div className="grid grid-rows-[var(--topbar-h)_1fr] h-full bg-bg text-ink">
      <header className="flex items-center gap-3 px-4 h-[var(--topbar-h)] bg-bg font-mono text-xs text-ink-2">
        <Link
          to="/"
          aria-label="rust-sa home"
          className="flex items-center gap-2 flex-shrink-0 whitespace-nowrap text-ink text-sm hover:text-rust"
        >
          <BrandMark />
          <span className="font-medium">rust-sa</span>
        </Link>
        <GitHubLink />
        <span className="text-mute pl-4 border-l border-hairline truncate">{repo}</span>
        <span className="text-faint">@</span>
        <span className="text-ink">{rev}</span>
        <div className="ml-auto flex items-center gap-3">
          <RefreshButton isRefreshing={manualRefreshing || loading} onRefresh={onManualRefresh} />
          <Link
            to="/compare/$"
            params={{ _splat: 'HEAD' }}
            search={{ repo }}
            className="inline-flex items-center gap-1.5 text-mute hover:text-ink"
          >
            <FileDiff size={16} aria-hidden="true" />
            diff
          </Link>
          <Link
            to="/graph"
            search={{ repo }}
            className="inline-flex items-center gap-1.5 text-mute hover:text-ink"
          >
            <GitGraph size={16} aria-hidden="true" />
            graph
          </Link>
        </div>
      </header>
      <div
        className="grid min-h-0 border-t border-hairline"
        style={{ gridTemplateColumns: `${treeW}px auto 1fr` }}
      >
        <aside className="bg-bg-soft border-r border-hairline min-h-0 overflow-hidden">
          {loading && <div className="px-4 py-3 font-mono text-xs text-mute">loading…</div>}
          {error && <div className="px-4 py-3 font-mono text-xs text-crimson">{error.message}</div>}
          {!loading && !error && (
            <FileTreeView
              paths={paths}
              search
              initialExpansion="closed"
              onSelectionChange={(sel) => {
                if (sel[0] && sel[0] !== selectedPath) selectPath(sel[0])
              }}
            />
          )}
        </aside>
        <ResizeHandle
          width={treeW}
          onWidthChange={(next) => setTreeWStr(String(Math.round(next)))}
          min={220}
          max={640}
          ariaLabel="resize file tree"
        />
        <main className="overflow-y-auto bg-bg min-w-0">
          {selectedPath ? (
            <BlobPane rev={rev} repo={repo} path={selectedPath} refreshKey={blobRefreshKey} />
          ) : (
            <div className="h-full flex items-center justify-center text-center px-6">
              <div className="flex flex-col items-center gap-3">
                <File size={28} aria-hidden="true" className="text-faint" />
                <p className="m-0 font-serif text-2xl text-faint">pick a file.</p>
                <p className="m-0 font-sans text-sm text-mute max-w-md">
                  Click any file in the tree to view its contents at <code>{rev}</code>.
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

interface BlobState {
  body: string
  html: string
  loading: boolean
  error: string | null
}

function BlobPane({
  rev,
  repo,
  path,
  refreshKey,
}: {
  rev: string
  repo: string
  path: string
  refreshKey: number
}) {
  const [state, setState] = useState<BlobState>({
    body: '',
    html: '',
    loading: true,
    error: null,
  })
  const [theme] = useThemePreference()

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, error: null }))
    let loadingTimer = window.setTimeout(() => {
      if (!cancelled) setState((s) => ({ ...s, loading: true }))
    }, 200)

    fetchBlob(rev, repo, path)
      .then(async (text) => {
        if (cancelled) return null
        const html = await highlightCode(text, path, theme).catch(() => '')
        return { text, html }
      })
      .then((result) => {
        if (cancelled || !result) return
        window.clearTimeout(loadingTimer)
        setState({ body: result.text, html: result.html, loading: false, error: null })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        window.clearTimeout(loadingTimer)
        setState({
          body: '',
          html: '',
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    return () => {
      cancelled = true
      window.clearTimeout(loadingTimer)
    }
  }, [rev, repo, path, refreshKey, theme])

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 z-10 px-4 py-2 bg-bg border-b border-hairline flex items-center gap-2 font-mono text-xs">
        <File size={14} aria-hidden="true" className="text-mute" />
        <span className="text-ink truncate">{path}</span>
      </header>
      <div className="flex-1 overflow-auto">
        {state.loading && <div className="px-4 py-3 font-mono text-xs text-mute">loading…</div>}
        {state.error && (
          <div className="px-4 py-3 font-mono text-xs text-crimson">{state.error}</div>
        )}
        {!state.loading && !state.error && state.html && (
          <div
            className="shiki-host px-4 py-3 font-mono text-xs"
            dangerouslySetInnerHTML={{ __html: state.html }}
          />
        )}
        {!state.loading && !state.error && !state.html && (
          <pre className="m-0 px-4 py-3 font-mono text-xs whitespace-pre text-ink">
            {state.body}
          </pre>
        )}
      </div>
    </div>
  )
}
