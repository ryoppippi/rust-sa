import { useQuery } from '#/lib/typed-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { DiffView } from '#/components/diff-view'
import { FileTreeView } from '#/components/file-tree-view'
import { HelpSheet } from '#/components/help-sheet'
import { LiveToast } from '#/components/live-toast'
import { ResizeHandle } from '#/components/ui/resize-handle'
import { TopBar, type Mode, type View } from '#/components/top-bar'
import { useHotkeys } from '@tanstack/react-hotkeys'
import { FilesDocument, type FilesQuery } from '#/graphql/generated/graphql'
import { shortSha } from '#/lib/short-sha'
import { useComments } from '#/lib/comments'
import { isDeepActiveInput } from '#/lib/deep-active-input'
import { usePreference, useRootAttribute } from '#/lib/preference'
import { useThemePreference } from '#/lib/server-preference'
import { useEvents } from '#/lib/sse'
import { useViewed } from '#/lib/viewed'

import type { GitStatusEntry } from '@pierre/trees'

type FileEntry = FilesQuery['files'][number]

function gitStatusKey(s: string): GitStatusEntry['status'] {
  if (s === 'added' || s === 'deleted' || s === 'modified' || s === 'renamed' || s === 'untracked')
    return s
  return 'modified'
}

type Density = 'compact' | 'regular' | 'comfy'
const DENSITIES: Density[] = ['compact', 'regular', 'comfy']
const nextDensity = (d: Density): Density =>
  DENSITIES[(DENSITIES.indexOf(d) + 1) % DENSITIES.length]

interface LoaderData {
  rev: string
  repo: string
  files: FileEntry[]
  w: boolean
}

interface CompareSearch {
  repo?: string
  w?: boolean
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

function specShortLabel(spec: string): string {
  const u = spec.toUpperCase()
  if (u === 'WORKING') return 'working'
  if (u === 'STAGING') return 'staging'
  return shortSha(spec)
}

export const Route = createFileRoute('/compare/$')({
  validateSearch: (search: Record<string, unknown>): CompareSearch => ({
    repo: typeof search.repo === 'string' ? search.repo : undefined,
    w: search.w === '1' || search.w === 1 || search.w === true ? true : undefined,
  }),
  loaderDeps: ({ search }) => ({ repo: search.repo, w: search.w }),
  loader: async ({ params, deps }): Promise<LoaderData> => {
    const rev = params._splat ?? 'HEAD'
    const repo = deps.repo
    const w = !!deps.w
    if (!repo) {
      throw new Error('?repo=<absolute-path> query parameter is required')
    }
    const { executeGraphQL } = await import('#/lib/apollo')
    const data = await executeGraphQL(FilesDocument, { rev, repo, w })
    return { rev, repo, files: data.files ?? [], w }
  },
  component: ComparePage,
})

function ComparePage() {
  const navigate = useNavigate()
  const [mode, setMode] = usePreference<Mode>('rust-sa:mode', 'unified')
  const [theme] = useThemePreference()
  const [density, setDensity] = usePreference<Density>('rust-sa:density', 'regular')
  const [treeWStr, setTreeWStr] = usePreference<string>('rust-sa:compare-tree-w', '280')
  const treeW = Number(treeWStr) || 280
  const [helpOpen, setHelpOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)

  useRootAttribute('data-theme', theme)
  useRootAttribute('data-density', density)

  const loaderData = Route.useLoaderData()
  const { rev, repo, files, w } = loaderData
  const setW = (next: boolean) => {
    navigate({
      to: '/compare/$',
      params: { _splat: rev },
      search: (prev) => ({ ...prev, w: next ? 1 : undefined }) as CompareSearch,
      replace: true,
    })
  }

  const onViewChange = (next: View) => {
    if (next === 'graph') navigate({ to: '/graph', search: { repo } })
  }

  const [refreshKey, setRefreshKey] = useState(0)
  const { data, refetch } = useQuery(FilesDocument, {
    variables: { rev, repo, w },
    skip: refreshKey === 0,
  })
  const liveFiles = refreshKey === 0 ? files : (data?.files ?? files)
  const [livePulse, setLivePulse] = useState(false)
  useEvents(
    repo,
    async () => {
      const result = await refetch()
      const next = result.data?.files ?? []
      const sig = (f: { path: string; additions: number; deletions: number }[]) =>
        f.map((x) => `${x.path}:${x.additions}:${x.deletions}`).join('|')
      if (sig(next) === sig(liveFiles)) return
      setRefreshKey((k) => k + 1)
      setLivePulse(true)
      window.setTimeout(() => setLivePulse(false), 1200)
    },
    1500,
  )
  const fileEntries = liveFiles.map((f) => ({ path: f.path, status: gitStatusKey(f.status) }))
  const paths = fileEntries.map((f) => f.path)
  const { isViewed, toggle } = useViewed(rev)
  const viewedCount = paths.filter((p) => isViewed(p)).length
  const {
    comments,
    add: addComment,
    remove: removeComment,
    clear: clearComments,
  } = useComments(rev)

  const currentPath = paths[focusedIndex] ?? paths[0]
  const { base, head, separator } = parseSpec(rev)

  const copyAllPrompts = () => {
    if (comments.length === 0) return
    const sorted = comments.toSorted(
      (a, b) => a.path.localeCompare(b.path) || a.startLineNumber - b.startLineNumber,
    )
    const text = sorted
      .map((c) => {
        const range =
          c.startLineNumber === c.endLineNumber
            ? `L${c.startLineNumber}`
            : `L${c.startLineNumber}–L${c.endLineNumber}`
        return `Re: ${c.path}:${range}\n${c.body}`
      })
      .join('\n\n')
    navigator.clipboard?.writeText(text)
  }

  useHotkeys(
    [
      { hotkey: { key: '/', shift: true }, callback: () => setHelpOpen((o) => !o) },
      {
        hotkey: 'S',
        callback: () => !isDeepActiveInput() && setMode(mode === 'unified' ? 'split' : 'unified'),
      },
      { hotkey: '.', callback: () => !isDeepActiveInput() && setDensity(nextDensity(density)) },
      { hotkey: 'V', callback: () => !isDeepActiveInput() && currentPath && toggle(currentPath) },
      {
        hotkey: ']',
        callback: () =>
          !isDeepActiveInput() &&
          paths.length &&
          setFocusedIndex((i) => Math.min(i + 1, paths.length - 1)),
      },
      {
        hotkey: '[',
        callback: () =>
          !isDeepActiveInput() && paths.length && setFocusedIndex((i) => Math.max(i - 1, 0)),
      },
      {
        hotkey: 'G',
        callback: () => !isDeepActiveInput() && navigate({ to: '/graph', search: { repo } }),
      },
    ],
    { preventDefault: true, ignoreInputs: true },
  )

  return (
    <div className="grid grid-rows-[var(--topbar-h)_1fr] h-full bg-bg text-ink">
      <TopBar
        base={specShortLabel(base)}
        head={separator ? specShortLabel(head) : undefined}
        separator={separator ?? undefined}
        mode={mode}
        onModeChange={setMode}
        view="diff"
        onViewChange={onViewChange}
        viewedCount={viewedCount}
        totalCount={paths.length}
        onCopyPrompts={comments.length > 0 ? copyAllPrompts : undefined}
        copyPromptsLabel={`copy ${comments.length}`}
        onClearPrompts={comments.length > 0 ? clearComments : undefined}
        clearPromptsLabel={`clear ${comments.length}`}
        isLive
        ignoreWhitespace={w}
        onIgnoreWhitespaceChange={setW}
      />
      <div
        className="grid min-h-0 border-t border-hairline"
        style={{ gridTemplateColumns: `${treeW}px auto 1fr` }}
      >
        <aside className="bg-bg-soft border-r border-hairline min-h-0 overflow-hidden">
          <FileTreeView
            paths={paths}
            gitStatus={fileEntries}
            header={<TreeHeader count={paths.length} />}
          />
        </aside>
        <ResizeHandle
          width={treeW}
          onWidthChange={(next) => setTreeWStr(String(Math.round(next)))}
          min={200}
          max={600}
          ariaLabel="resize file tree"
        />
        <main className="overflow-y-auto bg-bg min-w-0">
          <DiffView
            rev={rev}
            refreshKey={refreshKey}
            files={liveFiles}
            repo={repo}
            layout={mode}
            theme={theme}
            comments={comments}
            isViewed={isViewed}
            onToggleViewed={toggle}
            onAddComment={(input) => addComment({ ...input, author: 'you' })}
            onDeleteComment={removeComment}
            ignoreWhitespace={w}
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
    <div className="px-3 pt-4 pb-3 border-b border-hairline flex items-center justify-between font-mono text-xs uppercase tracking-widest text-mute">
      <span>files</span>
      <span className="text-ink normal-case tracking-normal text-xs">0 / {count} viewed</span>
    </div>
  )
}
