import { useQuery } from '#/lib/typed-query'
import {
  CommitsDocument,
  PreviewFilesDocument,
  RefsDocument,
  type CommitsQuery,
} from '#/graphql/generated/graphql'
import { isDeepActiveInput } from '#/lib/deep-active-input'
import { useHotkeys } from '@tanstack/react-hotkeys'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { GitStatusEntry } from '@pierre/trees'
import {
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  RotateCcw,
  Split,
  Tag as TagIcon,
} from 'lucide-react'
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react'
import { HelpSheet } from '#/components/help-sheet'
import { TopBar, type Mode, type Theme, type View } from '#/components/top-bar'
import { Button } from '#/components/ui/button'
import { ResizeHandle } from '#/components/ui/resize-handle'
import { Tag } from '#/components/ui/tag'
import clsx from 'clsx'
// DiffView pulls in pierre/diffs + every shiki grammar (~1 MB of JS). Lazy-load
// it so the initial /graph paint doesn't pay for diff rendering until the user
// has actually picked a commit and PREVIEW_FILES_QUERY has resolved.
const DiffView = lazy(() => import('#/components/diff-view').then((m) => ({ default: m.DiffView })))
import { FileTreeView } from '#/components/file-tree-view'
import { GraphColumn } from '#/components/graph-column'
import { RefSection } from '#/components/graph-ref-section'
import {
  isSpecial,
  specialLabel,
  SpecialMeta,
  SpecialRows,
  type SpecialId,
} from '#/components/graph-special'
import { layoutGraph, type GraphNode } from '#/lib/git-graph'
import { observeInView } from '#/lib/observer-pool'
import { usePreference, useRootAttribute } from '#/lib/preference'
import { useThemePreference } from '#/lib/server-preference'
import { shortenSpec, shortSha } from '#/lib/short-sha'

function specAtPoint(clientX: number, clientY: number): string | null {
  const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null
  const row = el?.closest('[data-spec]') as HTMLElement | null
  return row?.getAttribute('data-spec') ?? null
}

function gitStatusKey(s: string): GitStatusEntry['status'] {
  if (s === 'added' || s === 'deleted' || s === 'modified' || s === 'renamed' || s === 'untracked')
    return s
  return 'modified'
}

interface GraphSearch {
  repo?: string
  base?: string
  head?: string
  dot?: '2' | '3'
}

export const Route = createFileRoute('/graph')({
  validateSearch: (search: Record<string, unknown>): GraphSearch => ({
    repo: typeof search.repo === 'string' ? search.repo : undefined,
    base: typeof search.base === 'string' && search.base ? search.base : undefined,
    head: typeof search.head === 'string' && search.head ? search.head : undefined,
    dot: search.dot === '2' ? '2' : search.dot === '3' ? '3' : undefined,
  }),
  loaderDeps: ({ search }) => ({ repo: search.repo }),
  loader: ({ deps }) => {
    if (!deps.repo) {
      throw new Error('?repo=<absolute-path> query parameter is required')
    }
    return { repo: deps.repo }
  },
  component: GraphPage,
})

type Commit = CommitsQuery['commits'][number]

const PAGE_SIZE = 80

function GraphPage() {
  const navigate = useNavigate()
  const search = Route.useSearch()
  const [mode, setMode] = usePreference<Mode>('rust-sa:mode', 'unified')
  const [theme] = useThemePreference()
  const [density] = usePreference<'compact' | 'regular' | 'comfy'>('rust-sa:density', 'regular')
  const [commitsWStr, setCommitsWStr] = usePreference<string>('rust-sa:graph-commits-w', '420')
  const commitsW = Number(commitsWStr) || 420
  const [helpOpen, setHelpOpen] = useState(false)
  const [base, setBase] = useState<string | null>(search.base ?? null)
  const [head, setHead] = useState<string | null>(search.head ?? null)
  const [threeDot, setThreeDot] = useState(search.dot !== '2')

  useRootAttribute('data-theme', theme)
  useRootAttribute('data-density', density)

  useEffect(() => {
    navigate({
      to: '/graph',
      search: (prev) => ({
        ...prev,
        base: base ?? undefined,
        head: head ?? undefined,
        dot: threeDot ? undefined : '2',
      }),
      replace: true,
    })
  }, [base, head, threeDot, navigate])

  const { repo } = Route.useLoaderData()
  const { data, loading, error, fetchMore } = useQuery(CommitsDocument, {
    variables: { limit: PAGE_SIZE, skip: 0, repo },
    notifyOnNetworkStatusChange: true,
  })
  const commits = useMemo(() => data?.commits ?? [], [data?.commits])
  const { data: refsData } = useQuery(RefsDocument, {
    variables: { repo },
  })
  const branches = useMemo(() => refsData?.branches ?? [], [refsData?.branches])
  const tags = useMemo(() => refsData?.tags ?? [], [refsData?.tags])
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(false)

  const loadMore = async () => {
    if (loadingMore || exhausted || commits.length === 0) return
    setLoadingMore(true)
    try {
      const result = await fetchMore({
        variables: { limit: PAGE_SIZE, skip: commits.length, repo },
        updateQuery: (prev, { fetchMoreResult }) => {
          const more = fetchMoreResult?.commits ?? []
          if (more.length === 0) return prev
          const seen = new Set(prev.commits.map((c) => c.sha))
          const merged = [...prev.commits, ...more.filter((c) => !seen.has(c.sha))]
          return { commits: merged }
        },
      })
      if ((result.data?.commits.length ?? 0) < PAGE_SIZE) setExhausted(true)
    } finally {
      setLoadingMore(false)
    }
  }

  useHotkeys(
    [
      { hotkey: { key: '/', shift: true }, callback: () => setHelpOpen((o) => !o) },
      {
        hotkey: 'S',
        callback: () => !isDeepActiveInput() && setMode(mode === 'unified' ? 'split' : 'unified'),
      },
    ],
    { preventDefault: true, ignoreInputs: true },
  )

  const dragStartRef = useRef<string | null>(null)
  const draggedRef = useRef(false)

  const consumeDragFlag = (): boolean => {
    if (draggedRef.current) {
      draggedRef.current = false
      return true
    }
    return false
  }

  const onRowClick = useCallback((e: MouseEvent, sha: string) => {
    if (consumeDragFlag()) return
    if (e.ctrlKey || e.metaKey) setHead(sha)
    else setBase(sha)
  }, [])

  const onSpecialClick = useCallback((e: MouseEvent, id: SpecialId) => {
    if (consumeDragFlag()) return
    if (e.ctrlKey || e.metaKey) setHead(id)
    else setBase(id)
  }, [])

  const onRefClick = useCallback((e: MouseEvent, name: string) => {
    if (consumeDragFlag()) return
    if (e.ctrlKey || e.metaKey) setHead(name)
    else setBase(name)
  }, [])

  const openSpecDiff = useCallback(
    (spec: string) => {
      navigate({ to: '/compare/$', params: { _splat: shortenSpec(spec) }, search: { repo } })
    },
    [navigate, repo],
  )

  const onPaneDown = (e: MouseEvent) => {
    if (e.button !== 0) return
    if (e.ctrlKey || e.metaKey) return
    const sha = specAtPoint(e.clientX, e.clientY)
    if (!sha) return
    dragStartRef.current = sha
    draggedRef.current = false
  }

  const onPaneMove = (e: MouseEvent) => {
    const start = dragStartRef.current
    if (!start) return
    const sha = specAtPoint(e.clientX, e.clientY)
    if (sha && sha !== start) {
      draggedRef.current = true
      setBase(start)
      setHead(sha)
    }
  }

  const onPaneUp = () => {
    dragStartRef.current = null
  }

  const baseIsSpecial = isSpecial(base)
  const headIsSpecial = isSpecial(head)
  const anySpecial = baseIsSpecial || headIsSpecial

  const onViewChange = (next: View) => {
    if (next === 'diff')
      navigate({ to: '/compare/$', params: { _splat: 'HEAD' }, search: { repo } })
  }

  const previewSpec = useMemo(() => {
    if (!base) return null
    if (!head) return base
    // `git diff A...B` resolves to `merge_base(A, B)..B`, which collapses to
    // an empty diff when B is an ancestor of A (i.e. the user picked the
    // newer commit as base and the older one as head). Fall back to `..`
    // for that case so the reverse-direction diff actually renders.
    if (threeDot && !anySpecial) {
      const baseIdx = commits.findIndex((c) => c.sha === base)
      const headIdx = commits.findIndex((c) => c.sha === head)
      if (baseIdx >= 0 && headIdx >= 0 && baseIdx < headIdx) {
        return `${base}..${head}`
      }
    }
    return `${base}${threeDot ? '...' : '..'}${head}`
  }, [base, head, threeDot, anySpecial, commits])

  const rangeShas = useMemo(() => {
    if (!base || !head || anySpecial) return null as Set<string> | null
    const i = commits.findIndex((c) => c.sha === base)
    const j = commits.findIndex((c) => c.sha === head)
    if (i < 0 || j < 0) return null
    const [lo, hi] = i < j ? [i, j] : [j, i]
    return new Set(commits.slice(lo + 1, hi).map((c) => c.sha))
  }, [base, head, anySpecial, commits])

  const openDiff = () => {
    if (!previewSpec) return
    navigate({ to: '/compare/$', params: { _splat: shortenSpec(previewSpec) }, search: { repo } })
  }

  return (
    <div className="grid grid-rows-[var(--topbar-h)_1fr] h-full bg-bg text-ink">
      <TopBar
        base={base ? (specialLabel(base) ?? shortSha(base)) : '—'}
        head={
          baseIsSpecial && !head ? undefined : head ? (specialLabel(head) ?? shortSha(head)) : '—'
        }
        separator={baseIsSpecial && !head ? undefined : threeDot ? '···' : '··'}
        mode={mode}
        onModeChange={setMode}
        view="graph"
        onViewChange={onViewChange}
        viewedCount={0}
        totalCount={0}
      />
      <div
        className="border-t border-hairline grid min-h-0"
        style={{ gridTemplateColumns: `${commitsW}px auto 1fr` }}
      >
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <aside
          className="bg-bg-soft border-r border-hairline overflow-y-auto min-w-0 select-none"
          onMouseDown={onPaneDown}
          onMouseMove={onPaneMove}
          onMouseUp={onPaneUp}
        >
          <div className="sticky top-0 z-10 bg-bg-soft border-b border-hairline-soft px-4 pt-4 pb-2 font-mono text-xs uppercase tracking-widest text-mute flex items-center gap-1.5">
            <GitCommitHorizontal size={16} aria-hidden="true" />
            commits
            <span className="ml-auto normal-case tracking-normal text-mute">
              {commits.length}
              {exhausted ? '' : '+'}
            </span>
          </div>
          {loading && commits.length === 0 && (
            <div className="px-4 py-2 font-mono text-xs text-mute">loading…</div>
          )}
          {error && <div className="px-4 py-2 font-mono text-xs text-crimson">{error.message}</div>}
          <SpecialRows
            base={base}
            head={head}
            rowHeight={ROW_HEIGHT}
            onSelect={onSpecialClick}
            onDoubleSelect={openSpecDiff}
          />
          <RefSection
            title="branches"
            icon={GitBranch}
            refs={branches}
            base={base}
            head={head}
            rowHeight={ROW_HEIGHT}
            onClick={onRefClick}
            onDoubleClick={openSpecDiff}
            storageKey="rust-sa:graph-branches-open"
          />
          <RefSection
            title="tags"
            icon={TagIcon}
            refs={tags}
            base={base}
            head={head}
            rowHeight={ROW_HEIGHT}
            onClick={onRefClick}
            onDoubleClick={openSpecDiff}
            storageKey="rust-sa:graph-tags-open"
          />
          <CommitList
            commits={commits}
            base={base}
            head={head}
            rangeShas={rangeShas}
            onRowClick={onRowClick}
            onRowDoubleClick={openSpecDiff}
          />
          <LoadMoreSentinel
            onVisible={loadMore}
            disabled={loadingMore || exhausted || commits.length === 0}
            loading={loadingMore}
            exhausted={exhausted}
          />
        </aside>
        <ResizeHandle
          width={commitsW}
          onWidthChange={(w) => setCommitsWStr(String(Math.round(w)))}
          min={280}
          max={900}
          ariaLabel="resize commits pane"
        />
        <main className="relative overflow-hidden bg-bg min-w-0">
          {previewSpec ? (
            <DiffPreview
              rev={previewSpec}
              repo={repo}
              layout={mode}
              theme={theme}
              commit={anySpecial || head ? null : (commits.find((c) => c.sha === base) ?? null)}
              special={
                baseIsSpecial && !head
                  ? (base as SpecialId)
                  : headIsSpecial && !baseIsSpecial
                    ? (head as SpecialId)
                    : null
              }
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-4 text-center px-6">
                <h2 className="m-0 font-serif text-4xl tracking-tight text-faint">
                  pick a commit.
                </h2>
                <p className="m-0 font-sans text-sm text-mute max-w-md">
                  Click to set <span className="text-rust font-medium">base</span> (older)
                  {' · '}⌃ / ⌘ + click to set <span className="text-moss font-medium">head</span>{' '}
                  (newer).
                </p>
                <p className="m-0 font-sans text-xs text-faint max-w-md">
                  Selecting only base shows that commit&apos;s diff against its parent. Selecting
                  both shows base
                  {threeDot ? '…head' : '..head'}.
                </p>
              </div>
            </div>
          )}
          <GraphSummary
            base={base}
            head={head}
            threeDot={threeDot}
            onToggleThreeDot={() => setThreeDot((t) => !t)}
            onOpen={openDiff}
            onClear={() => {
              setBase(null)
              setHead(null)
            }}
          />
        </main>
      </div>
      <HelpSheet isOpen={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  )
}

function DiffPreview({
  rev,
  repo,
  layout,
  theme,
  commit,
  special,
}: {
  rev: string
  repo: string
  layout: Mode
  theme: Theme
  commit: Commit | null
  special: SpecialId | null
}) {
  const [treeWStr, setTreeWStr] = usePreference<string>('rust-sa:graph-tree-w', '280')
  const treeW = Number(treeWStr) || 280
  const { data, loading, error } = useQuery(PreviewFilesDocument, {
    variables: { rev, repo },
    fetchPolicy: 'cache-and-network',
  })
  const files = data?.files ?? []
  const fileEntries = files.map((f) => ({ path: f.path, status: gitStatusKey(f.status) }))
  const paths = fileEntries.map((f) => f.path)

  let body: React.ReactNode
  if (loading && files.length === 0) {
    body = (
      <div className="h-full flex items-center justify-center font-mono text-xs text-mute">
        loading diff…
      </div>
    )
  } else if (error) {
    body = (
      <div className="h-full flex items-start justify-center px-6 pt-10 font-mono text-xs text-crimson">
        {error.message}
      </div>
    )
  } else if (files.length === 0) {
    body = (
      <div className="h-full flex items-center justify-center font-mono text-xs text-mute">
        no changes in this range
      </div>
    )
  } else {
    body = (
      <Suspense
        fallback={
          <div className="h-full flex items-center justify-center font-mono text-xs text-mute">
            preparing diff…
          </div>
        }
      >
        <DiffView
          rev={rev}
          refreshKey={0}
          files={files}
          repo={repo}
          layout={layout}
          theme={theme}
        />
      </Suspense>
    )
  }

  return (
    <div
      className="absolute inset-0 pb-20 grid min-h-0"
      style={{ gridTemplateColumns: `${treeW}px auto 1fr` }}
    >
      <aside className="bg-bg-soft border-r border-hairline min-h-0 overflow-hidden">
        <FileTreeView
          paths={paths}
          gitStatus={fileEntries}
          header={<PreviewTreeHeader count={paths.length} />}
        />
      </aside>
      <ResizeHandle
        width={treeW}
        onWidthChange={(w) => setTreeWStr(String(Math.round(w)))}
        min={200}
        max={600}
        ariaLabel="resize file tree"
      />
      <div className="overflow-y-auto min-w-0">
        {special && <SpecialMeta special={special} />}
        <CommitMeta commit={commit} />
        {body}
      </div>
    </div>
  )
}

function LoadMoreSentinel({
  onVisible,
  disabled,
  loading,
  exhausted,
}: {
  onVisible: () => void
  disabled: boolean
  loading: boolean
  exhausted: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (disabled) return
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) onVisible()
      },
      { rootMargin: '200px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [disabled, onVisible])
  return (
    <div ref={ref} className="px-4 py-3 font-mono text-xs text-faint text-center">
      {exhausted ? 'end of history' : loading ? 'loading more…' : ''}
    </div>
  )
}

function PreviewTreeHeader({ count }: { count: number }) {
  return (
    <div className="px-3 pt-4 pb-3 border-b border-hairline flex items-center justify-between font-mono text-xs uppercase tracking-widest text-mute">
      <span>files</span>
      <span className="text-ink normal-case tracking-normal text-xs">{count}</span>
    </div>
  )
}

const COMMIT_META_RESERVED_HEIGHT = 124

function CommitMeta({ commit }: { commit: Commit | null }) {
  const refParts =
    commit?.refs
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? []
  return (
    <header
      className="px-5 pt-5 pb-4 border-b border-hairline bg-bg"
      style={{ minHeight: COMMIT_META_RESERVED_HEIGHT }}
    >
      <div className="flex items-baseline gap-3 font-mono text-xs text-mute flex-wrap">
        <span className="text-rust">{commit?.short ?? ' '}</span>
        {commit && (
          <>
            <span>{commit.author}</span>
            <span>·</span>
            <span>{commit.when}</span>
          </>
        )}
      </div>
      <h2 className="mt-2 m-0 font-serif text-xl tracking-tight text-ink">
        {commit?.message ?? 'Loading commit…'}
      </h2>
      {refParts.length > 0 && (
        <div className="mt-2 inline-flex flex-wrap gap-1">
          {refParts.map((p) => {
            const isHeadRef = p.includes('HEAD')
            const isTag = p.startsWith('tag:')
            const label = isTag ? p.replace('tag: ', '') : p.replace('HEAD -> ', '')
            return (
              <Tag key={p} tone={isHeadRef ? 'rust' : isTag ? 'neutral' : 'moss'}>
                {label}
              </Tag>
            )
          })}
        </div>
      )}
    </header>
  )
}

const ROW_HEIGHT = 28

function CommitList({
  commits,
  base,
  head,
  rangeShas,
  onRowClick,
  onRowDoubleClick,
}: {
  commits: Commit[]
  base: string | null
  head: string | null
  rangeShas: Set<string> | null
  onRowClick: (e: MouseEvent, sha: string) => void
  onRowDoubleClick: (sha: string) => void
}) {
  const nodes = useMemo(() => layoutGraph(commits), [commits])
  const totalLanes = useMemo(
    () =>
      nodes.reduce(
        (max, n) =>
          Math.max(
            max,
            n.lane + 1,
            ...n.parentLanes.map((p) => p + 1),
            ...n.passing.map((p) => p + 1),
          ),
        1,
      ),
    [nodes],
  )
  return (
    <>
      {commits.map((c, i) => (
        <CommitRow
          key={c.sha}
          commit={c}
          node={nodes[i]}
          nextNode={nodes[i + 1]}
          totalLanes={totalLanes}
          isBase={base === c.sha}
          isHead={head === c.sha}
          isInRange={rangeShas?.has(c.sha) ?? false}
          onSelect={onRowClick}
          onActivate={onRowDoubleClick}
        />
      ))}
    </>
  )
}

const COMMIT_VIEWPORT_MARGIN: IntersectionObserverInit = { rootMargin: '1500px 0px' }

const CommitRow = memo(function CommitRow({
  commit,
  node,
  nextNode,
  totalLanes,
  isBase,
  isHead,
  isInRange,
  onSelect,
  onActivate,
}: {
  commit: Commit
  node: GraphNode
  nextNode: GraphNode | undefined
  totalLanes: number
  isBase: boolean
  isHead: boolean
  isInRange: boolean
  onSelect: (e: MouseEvent, sha: string) => void
  onActivate: (sha: string) => void
}) {
  // Virtualise: rows outside ~3 viewport-heights collapse to a placeholder
  // div of the same height so the SVG graph column + ref badges + per-row
  // listeners are released. Callback ref keeps the IntersectionObserver
  // attached when the rendered element type flips between button and div.
  const [inRange, setInRange] = useState(true)
  const [el, setEl] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!el) return
    return observeInView(el, COMMIT_VIEWPORT_MARGIN, setInRange)
  }, [el])

  if (!inRange) {
    return (
      <div
        ref={setEl}
        data-spec={commit.sha}
        aria-hidden="true"
        style={{ height: ROW_HEIGHT }}
        className="border-b border-hairline-soft"
      />
    )
  }
  return (
    <button
      ref={setEl}
      type="button"
      data-spec={commit.sha}
      onClick={(e) => onSelect(e, commit.sha)}
      onDoubleClick={() => onActivate(commit.sha)}
      style={{ height: ROW_HEIGHT }}
      className={clsx(
        'w-full text-left flex items-center gap-2 pr-3 border-b border-hairline-soft font-mono text-xs cursor-pointer hover:bg-bg-card',
        isBase && 'bg-rust-soft',
        isHead && 'bg-moss-soft',
        !isBase && !isHead && isInRange && 'bg-bg-strong/60',
      )}
    >
      <GraphColumn node={node} nextNode={nextNode} rowHeight={ROW_HEIGHT} totalLanes={totalLanes} />
      <span className="text-rust">{commit.short}</span>
      <span className="text-ink flex-1 whitespace-nowrap overflow-hidden text-ellipsis">
        {commit.message}
      </span>
      {commit.refs && <RefBadges refs={commit.refs} isBase={isBase} isHead={isHead} />}
      <span className="text-mute text-xs flex-shrink-0">{commit.when}</span>
    </button>
  )
})

function RefBadges({ refs, isBase, isHead }: { refs: string; isBase: boolean; isHead: boolean }) {
  const parts = refs
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2)
  return (
    <span className="inline-flex gap-1 flex-shrink-0">
      {parts.map((p) => {
        const isHeadRef = p.includes('HEAD')
        const isTag = p.startsWith('tag:')
        const label = isTag ? p.replace('tag: ', '') : p.replace('HEAD -> ', '')
        return (
          <Tag key={p} tone={isHeadRef ? 'rust' : isTag ? 'neutral' : 'moss'}>
            {label}
          </Tag>
        )
      })}
      {isBase && <Tag tone="rust">base</Tag>}
      {isHead && <Tag tone="moss">head</Tag>}
    </span>
  )
}

function GraphSummary({
  base,
  head,
  threeDot,
  onToggleThreeDot,
  onOpen,
  onClear,
}: {
  base: string | null
  head: string | null
  threeDot: boolean
  onToggleThreeDot: () => void
  onOpen: () => void
  onClear: () => void
}) {
  return (
    <div className="absolute left-5 right-5 bottom-5 bg-bg border border-hairline rounded-sm px-5 py-4 font-mono text-xs flex items-center gap-4">
      <span className="text-xs uppercase tracking-wider text-mute">compare</span>
      <span className="inline-flex items-center gap-1.5 text-ink">
        <span className="w-2 h-2 rounded-full inline-block bg-rust" />
        {base ? (
          (specialLabel(base) ?? shortSha(base))
        ) : (
          <span className="text-mute font-normal">click</span>
        )}
      </span>
      <button
        type="button"
        onClick={onToggleThreeDot}
        aria-label={
          threeDot
            ? '··· three-dot range, switch to two-dot'
            : '·· two-dot range, switch to three-dot'
        }
        className="text-mute hover:text-ink cursor-pointer px-1 -mx-1 rounded-sm"
      >
        {threeDot ? '···' : '··'}
      </button>
      <span className="inline-flex items-center gap-1.5 text-ink">
        <span className="w-2 h-2 rounded-full inline-block bg-moss" />
        {head ? (
          (specialLabel(head) ?? shortSha(head))
        ) : (
          <span className="text-mute font-normal">⌃ / ⌘ + click</span>
        )}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onPress={onToggleThreeDot}
        aria-label={threeDot ? 'switch to two-dot' : 'switch to three-dot'}
      >
        <Split size={16} aria-hidden="true" />
      </Button>
      <span className="flex-1" />
      <Button variant="ghost" size="sm" onPress={onClear}>
        <RotateCcw size={16} aria-hidden="true" />
        clear
      </Button>
      <Button variant="primary" size="sm" onPress={onOpen} isDisabled={!base}>
        <FileDiff size={16} aria-hidden="true" />
        open diff
      </Button>
    </div>
  )
}
