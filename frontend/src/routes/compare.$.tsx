import { gql } from '@apollo/client'
import { useQuery } from '@apollo/client/react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { DiffView } from '#/components/diff-view'
import { FileTreeView } from '#/components/file-tree-view'
import { HelpSheet } from '#/components/help-sheet'
import { LiveToast } from '#/components/live-toast'
import { TopBar, type Mode, type Theme, type View } from '#/components/top-bar'
import { ViewedCheck } from '#/components/ui/viewed-check'
import { API_ORIGIN } from '#/lib/apollo'
import { useComments } from '#/lib/comments'
import { useKeybindings } from '#/lib/keybindings'
import { usePreference, useRootAttribute } from '#/lib/preference'
import { useSSE } from '#/lib/sse'
import { useViewed } from '#/lib/viewed'

import type { GitStatusEntry } from '@pierre/trees'

interface FileEntry {
  path: string
  status: string
  additions: number
  deletions: number
}

function gitStatusKey(s: string): GitStatusEntry['status'] {
  if (s === 'added' || s === 'deleted' || s === 'modified' || s === 'renamed') return s
  return 'modified'
}

const FILES_QUERY = gql`
  query Files($rev: String!, $repo: String!) {
    files(rev: $rev, repo: $repo) {
      path
      status
      additions
      deletions
    }
  }
`

type Density = 'compact' | 'regular' | 'comfy'
const DENSITIES: Density[] = ['compact', 'regular', 'comfy']
const nextDensity = (d: Density): Density => DENSITIES[(DENSITIES.indexOf(d) + 1) % DENSITIES.length]

interface LoaderData {
  rev: string
  repo: string
  files: FileEntry[]
}

interface CompareSearch {
  repo?: string
}

function parseSpec(spec: string): { base: string; head: string; separator: '··' | '···' | null } {
  if (spec.includes('...')) {
    const [base, head] = spec.split('...', 2)
    return { base, head, separator: '···' }
  }
  if (spec.includes('..')) {
    const [base, head] = spec.split('..', 2)
    return { base, head, separator: '··' }
  }
  return { base: spec, head: spec, separator: null }
}

export const Route = createFileRoute('/compare/$')({
  validateSearch: (search: Record<string, unknown>): CompareSearch => ({
    repo: typeof search.repo === 'string' ? search.repo : undefined,
  }),
  loaderDeps: ({ search }) => ({ repo: search.repo }),
  loader: async ({ params, deps }): Promise<LoaderData> => {
    const rev = params._splat ?? 'HEAD'
    const repo = deps.repo
    if (!repo) {
      throw new Error('?repo=<absolute-path> query parameter is required')
    }
    const { SERVER_ORIGIN } = await import('#/lib/server-origin')
    const res = await fetch(`${SERVER_ORIGIN}/api/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query:
          'query Files($rev: String!, $repo: String!) { files(rev: $rev, repo: $repo) { path status additions deletions } }',
        variables: { rev, repo },
      }),
    })
    const json = (await res.json()) as { data?: { files?: FileEntry[] } }
    return { rev, repo, files: json.data?.files ?? [] }
  },
  component: ComparePage,
})

function ComparePage() {
  const navigate = useNavigate()
  const [mode, setMode] = usePreference<Mode>('rust-sa:mode', 'unified')
  const [theme, setTheme] = usePreference<Theme>('rust-sa:theme', 'light')
  const [density, setDensity] = usePreference<Density>('rust-sa:density', 'regular')
  const [helpOpen, setHelpOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)

  useRootAttribute('data-theme', theme)
  useRootAttribute('data-density', density)

  const loaderData = Route.useLoaderData()
  const { rev, repo, files } = loaderData

  const onViewChange = (next: View) => {
    if (next === 'graph') navigate({ to: '/graph', search: { repo } })
  }

  const [refreshKey, setRefreshKey] = useState(0)
  const { data, refetch } = useQuery<{ files: FileEntry[] }>(FILES_QUERY, {
    variables: { rev, repo },
    skip: refreshKey === 0,
  })
  const liveFiles = refreshKey === 0 ? files : data?.files ?? files
  const [livePulse, setLivePulse] = useState(false)
  useSSE(`${API_ORIGIN}/api/events`, () => {
    setRefreshKey((k) => k + 1)
    refetch()
    setLivePulse(true)
    window.setTimeout(() => setLivePulse(false), 2500)
  })
  const fileEntries = useMemo(
    () => liveFiles.map((f) => ({ path: f.path, status: gitStatusKey(f.status) })),
    [liveFiles],
  )
  const paths = useMemo(() => fileEntries.map((f) => f.path), [fileEntries])
  const { isViewed, toggle } = useViewed(rev)
  const viewedCount = paths.filter((p) => isViewed(p)).length
  const { comments, add: addComment, remove: removeComment } = useComments(rev)

  const currentPath = paths[focusedIndex] ?? paths[0]
  const { base, head, separator } = parseSpec(rev)

  useKeybindings({
    '?': () => setHelpOpen((o) => !o),
    s: () => setMode(mode === 'unified' ? 'split' : 'unified'),
    '.': () => setDensity(nextDensity(density)),
    v: () => currentPath && toggle(currentPath),
    ']': () => paths.length && setFocusedIndex((i) => Math.min(i + 1, paths.length - 1)),
    '[': () => paths.length && setFocusedIndex((i) => Math.max(i - 1, 0)),
    g: () => navigate({ to: '/graph', search: { repo } }),
  })

  return (
    <div className="grid grid-rows-[var(--topbar-h)_1fr] h-screen bg-bg text-ink">
      <TopBar
        base={base}
        head={separator ? head : base}
        separator={separator ?? '··'}
        mode={mode}
        onModeChange={setMode}
        theme={theme}
        onThemeChange={setTheme}
        view="diff"
        onViewChange={onViewChange}
        viewedCount={viewedCount}
        totalCount={paths.length}
        onHelp={() => setHelpOpen(true)}
        isLive
      />
      <div className="grid grid-cols-[var(--tree-w)_1fr] min-h-0 border-t border-hairline">
        <aside className="bg-bg-soft border-r border-hairline min-h-0 overflow-hidden">
          <FileTreeView
            paths={paths}
            gitStatus={fileEntries}
            header={<TreeHeader count={paths.length} />}
          />
        </aside>
        <main className="overflow-y-auto bg-bg min-w-0">
          <DiffView
            rev={rev}
            refreshKey={refreshKey}
            files={liveFiles}
            repo={repo}
            layout={mode}
            theme={theme}
            comments={comments}
            renderHeaderMetadata={(file) => (
              <ViewedCheck
                isOn={isViewed(file.name)}
                onToggle={() => toggle(file.name)}
              />
            )}
            onAddComment={(input) => addComment({ ...input, author: 'you' })}
            onDeleteComment={removeComment}
          />
        </main>
      </div>
      <HelpSheet isOpen={helpOpen} onOpenChange={setHelpOpen} />
      {livePulse && <LiveToast />}
    </div>
  )
}

function TreeHeader({ count }: { count: number }) {
  return (
    <div className="px-3 pt-4 pb-3 border-b border-hairline flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.08em] text-mute">
      <span>files</span>
      <span className="text-ink normal-case tracking-normal text-[11px]">
        0 / {count} viewed
      </span>
    </div>
  )
}
