import { gql } from '@apollo/client'
import { useQuery } from '@apollo/client/react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { File } from 'lucide-react'
import { useEffect, useState } from 'react'
import { FileTreeView } from '#/components/file-tree-view'
import { ResizeHandle } from '#/components/ui/resize-handle'
import { API_ORIGIN } from '#/lib/apollo'
import { usePreference, useRootAttribute } from '#/lib/preference'
import { useThemePreference } from '#/lib/server-preference'

interface BrowseSearch {
  repo?: string
  rev?: string
  path?: string
}

const TREE_QUERY = gql`
  query Tree($repo: String!, $rev: String) {
    tree(repo: $repo, rev: $rev)
  }
`

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

  const { data, loading, error } = useQuery<{ tree: string[] }>(TREE_QUERY, {
    variables: { repo, rev },
  })
  const paths = data?.tree ?? []

  const selectPath = (next: string) => {
    navigate({
      to: '/browse',
      search: (s) => ({ ...(s as BrowseSearch), path: next }),
      replace: true,
    })
  }

  return (
    <div className="grid grid-rows-[var(--topbar-h)_1fr] h-screen bg-bg text-ink">
      <header className="flex items-center gap-3 px-4 h-[var(--topbar-h)] bg-bg font-mono text-xs text-ink-2">
        <Link
          to="/"
          aria-label="rust-sa home"
          className="flex items-center gap-2 flex-shrink-0 whitespace-nowrap text-ink text-sm hover:text-rust"
        >
          <BrandMark />
          <span className="font-medium">rust-sa</span>
        </Link>
        <span className="text-mute pl-4 border-l border-hairline truncate">{repo}</span>
        <span className="text-faint">@</span>
        <span className="text-ink">{rev}</span>
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
            <BlobPane rev={rev} repo={repo} path={selectedPath} />
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

function BlobPane({ rev, repo, path }: { rev: string; repo: string; path: string }) {
  const [body, setBody] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const url = `${API_ORIGIN}/api/blob?rev=${encodeURIComponent(rev)}&path=${encodeURIComponent(path)}&repo=${encodeURIComponent(repo)}`
    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
        return r.text()
      })
      .then((text) => {
        if (!cancelled) {
          setBody(text)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [rev, repo, path])

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 z-10 px-4 py-2 bg-bg border-b border-hairline flex items-center gap-2 font-mono text-xs">
        <File size={14} aria-hidden="true" className="text-mute" />
        <span className="text-ink truncate">{path}</span>
      </header>
      <div className="flex-1 overflow-auto">
        {loading && <div className="px-4 py-3 font-mono text-xs text-mute">loading…</div>}
        {error && <div className="px-4 py-3 font-mono text-xs text-crimson">{error}</div>}
        {!loading && !error && (
          <pre className="m-0 px-4 py-3 font-mono text-xs whitespace-pre text-ink">{body}</pre>
        )}
      </div>
    </div>
  )
}

function BrandMark() {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      <i className="inline-block w-1 h-3.5 bg-rust" />
      <i className="inline-block w-1 h-3.5 bg-ink mt-1" />
      <i className="inline-block w-1 h-3.5 bg-rust opacity-50 -mt-1" />
    </span>
  )
}
