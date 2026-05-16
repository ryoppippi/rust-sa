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
import { useDiff } from '#/lib/diff-api'
import { useKeybindings } from '#/lib/keybindings'
import { pathFromPatch, splitPatchByFile, statusFromPatch } from '#/lib/parse-patch'
import { usePreference, useRootAttribute } from '#/lib/preference'
import { useSSE } from '#/lib/sse'
import { useViewed } from '#/lib/viewed'

type Density = 'compact' | 'regular' | 'comfy'
const DENSITIES: Density[] = ['compact', 'regular', 'comfy']
const nextDensity = (d: Density): Density => DENSITIES[(DENSITIES.indexOf(d) + 1) % DENSITIES.length]

interface DiffSearch {
  rev?: string
}

export const Route = createFileRoute('/diff')({
  validateSearch: (search: Record<string, unknown>): DiffSearch => ({
    rev: typeof search.rev === 'string' ? search.rev : undefined,
  }),
  component: DiffPage,
})

function DiffPage() {
  const navigate = useNavigate()
  const [mode, setMode] = usePreference<Mode>('rust-sa:mode', 'unified')
  const [theme, setTheme] = usePreference<Theme>('rust-sa:theme', 'light')
  const [density, setDensity] = usePreference<Density>('rust-sa:density', 'regular')
  const [helpOpen, setHelpOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)

  useRootAttribute('data-theme', theme)
  useRootAttribute('data-density', density)

  const onViewChange = (next: View) => {
    if (next === 'graph') navigate({ to: '/graph' })
  }

  const search = Route.useSearch()
  const rev = search.rev ?? 'HEAD'
  const [refreshKey, setRefreshKey] = useState(0)
  const { patch, loading, error } = useDiff(rev, refreshKey)
  const [livePulse, setLivePulse] = useState(false)
  useSSE(`${API_ORIGIN}/api/events`, () => {
    setRefreshKey((k) => k + 1)
    setLivePulse(true)
    window.setTimeout(() => setLivePulse(false), 2500)
  })
  const fileEntries = useMemo(
    () =>
      splitPatchByFile(patch).map((p) => ({
        path: pathFromPatch(p),
        status: statusFromPatch(p),
      })),
    [patch],
  )
  const paths = useMemo(() => fileEntries.map((f) => f.path), [fileEntries])
  const { isViewed, toggle } = useViewed(rev)
  const viewedCount = paths.filter((p) => isViewed(p)).length
  const { comments, add: addComment, remove: removeComment } = useComments(rev)

  const currentPath = paths[focusedIndex] ?? paths[0]

  useKeybindings({
    '?': () => setHelpOpen((o) => !o),
    s: () => setMode(mode === 'unified' ? 'split' : 'unified'),
    '.': () => setDensity(nextDensity(density)),
    v: () => currentPath && toggle(currentPath),
    ']': () => paths.length && setFocusedIndex((i) => Math.min(i + 1, paths.length - 1)),
    '[': () => paths.length && setFocusedIndex((i) => Math.max(i - 1, 0)),
    g: () => navigate({ to: '/graph' }),
  })

  return (
    <div className="grid grid-rows-[var(--topbar-h)_1fr] h-screen bg-bg text-ink">
      <TopBar
        base={rev.split('..')[0] || rev}
        head={rev.includes('..') ? rev.split('..').slice(-1)[0] : rev}
        separator={rev.includes('...') ? '···' : '··'}
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
          {loading && (
            <div className="p-6 font-mono text-[12px] text-mute">loading diff…</div>
          )}
          {error && (
            <div className="p-6 font-mono text-[12px] text-crimson">
              {error.message}
            </div>
          )}
          {!loading && !error && (
            <DiffView
              patch={patch}
              layout={mode}
              theme={theme}
              comments={comments}
              renderHeaderMetadata={(file) => (
                <ViewedCheck
                  isOn={isViewed(file.name)}
                  onToggle={() => toggle(file.name)}
                />
              )}
              onAddComment={(input) =>
                addComment({ ...input, author: 'you' })
              }
              onDeleteComment={removeComment}
            />
          )}
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
