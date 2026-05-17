import { gql } from '@apollo/client'
import { useQuery } from '@apollo/client/react'
import { useHotkeys } from '@tanstack/react-hotkeys'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { GitStatusEntry } from '@pierre/trees'
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  FileDiff,
  FilePen,
  GitBranch,
  GitCommitHorizontal,
  RotateCcw,
  Search,
  Split,
  Tag as TagIcon,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Button as AriaButton, Input as AriaInput, SearchField } from 'react-aria-components'
import { HelpSheet } from '#/components/help-sheet'
import { TopBar, type Mode, type Theme, type View } from '#/components/top-bar'
import { Button } from '#/components/ui/button'
import { ResizeHandle } from '#/components/ui/resize-handle'
import { Tag } from '#/components/ui/tag'
import clsx from 'clsx'
import { DiffView } from '#/components/diff-view'
import { FileTreeView } from '#/components/file-tree-view'
import { GraphColumn } from '#/components/graph-column'
import { fuzzyScore } from '#/lib/fuzzy'
import { layoutGraph, type GraphNode } from '#/lib/git-graph'
import { usePreference, useRootAttribute } from '#/lib/preference'
import { useThemePreference } from '#/lib/server-preference'
import { shortSha } from '#/lib/short-sha'

function gitStatusKey(s: string): GitStatusEntry['status'] {
  if (s === 'added' || s === 'deleted' || s === 'modified' || s === 'renamed') return s
  return 'modified'
}

interface GraphSearch {
  repo?: string
}

export const Route = createFileRoute('/graph')({
  validateSearch: (search: Record<string, unknown>): GraphSearch => ({
    repo: typeof search.repo === 'string' ? search.repo : undefined,
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

interface Commit {
  sha: string
  short: string
  message: string
  author: string
  when: string
  refs: string
  parents: string[]
}

const COMMITS_QUERY = gql`
  query Commits($limit: Int, $skip: Int, $repo: String!) {
    commits(limit: $limit, skip: $skip, repo: $repo) {
      sha
      short
      message
      author
      when
      refs
      parents
    }
  }
`

const PAGE_SIZE = 80

interface PreviewFile {
  path: string
  status: string
  additions: number
  deletions: number
}

const PREVIEW_FILES_QUERY = gql`
  query PreviewFiles($rev: String!, $repo: String!) {
    files(rev: $rev, repo: $repo) {
      path
      status
      additions
      deletions
    }
  }
`

interface GitRef {
  name: string
  shortSha: string
  isCurrent: boolean
}

const REFS_QUERY = gql`
  query Refs($repo: String!) {
    branches(repo: $repo) {
      name
      shortSha
      isCurrent
    }
    tags(repo: $repo) {
      name
      shortSha
      isCurrent
    }
  }
`

function GraphPage() {
  const navigate = useNavigate()
  const [mode, setMode] = usePreference<Mode>('rust-sa:mode', 'unified')
  const [theme] = useThemePreference()
  const [density] = usePreference<'compact' | 'regular' | 'comfy'>('rust-sa:density', 'regular')
  const [commitsWStr, setCommitsWStr] = usePreference<string>('rust-sa:graph-commits-w', '420')
  const commitsW = Number(commitsWStr) || 420
  const [helpOpen, setHelpOpen] = useState(false)
  const [base, setBase] = useState<string | null>(null)
  const [head, setHead] = useState<string | null>(null)
  const [threeDot, setThreeDot] = useState(true)

  useRootAttribute('data-theme', theme)
  useRootAttribute('data-density', density)

  const { repo } = Route.useLoaderData()
  const { data, loading, error, fetchMore } = useQuery<{ commits: Commit[] }>(COMMITS_QUERY, {
    variables: { limit: PAGE_SIZE, skip: 0, repo },
    notifyOnNetworkStatusChange: true,
  })
  const commits = data?.commits ?? []
  const { data: refsData } = useQuery<{ branches: GitRef[]; tags: GitRef[] }>(REFS_QUERY, {
    variables: { repo },
  })
  const branches = refsData?.branches ?? []
  const tags = refsData?.tags ?? []
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
      { hotkey: 'S', callback: () => setMode(mode === 'unified' ? 'split' : 'unified') },
    ],
    { preventDefault: true, ignoreInputs: true },
  )

  const onRowClick = (e: MouseEvent, sha: string) => {
    if (e.ctrlKey || e.metaKey) setHead(sha)
    else setBase(sha)
  }

  const onSpecialClick = (e: MouseEvent, id: 'WORKING' | 'STAGING') => {
    if (e.ctrlKey || e.metaKey) setHead(id)
    else setBase(id)
  }

  const onRefClick = (e: MouseEvent, name: string) => {
    if (e.ctrlKey || e.metaKey) setHead(name)
    else setBase(name)
  }

  const baseIsSpecial = isSpecial(base)
  const headIsSpecial = isSpecial(head)
  const anySpecial = baseIsSpecial || headIsSpecial

  const onViewChange = (next: View) => {
    if (next === 'diff')
      navigate({ to: '/compare/$', params: { _splat: 'HEAD' }, search: { repo } })
  }

  const previewSpec = base
    ? head
      ? `${base}${threeDot ? '...' : '..'}${head}`
      : baseIsSpecial
        ? base
        : base
    : null

  const openDiff = () => {
    if (!previewSpec) return
    navigate({ to: '/compare/$', params: { _splat: previewSpec }, search: { repo } })
  }

  return (
    <div className="grid grid-rows-[var(--topbar-h)_1fr] h-screen bg-bg text-ink">
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
        <aside className="bg-bg-soft border-r border-hairline overflow-y-auto min-w-0">
          <div className="sticky top-0 z-10 bg-bg-soft border-b border-hairline-soft px-4 pt-4 pb-2 font-mono text-xs uppercase tracking-widest text-mute flex items-center gap-1.5">
            <GitCommitHorizontal size={16} aria-hidden="true" />
            commits
            <span className="ml-auto normal-case tracking-normal text-faint">
              {commits.length}
              {exhausted ? '' : '+'}
            </span>
          </div>
          {loading && commits.length === 0 && (
            <div className="px-4 py-2 font-mono text-xs text-mute">loading…</div>
          )}
          {error && <div className="px-4 py-2 font-mono text-xs text-crimson">{error.message}</div>}
          <SpecialRows base={base} head={head} onSelect={onSpecialClick} />
          <RefSection
            title="branches"
            icon={GitBranch}
            refs={branches}
            base={base}
            head={head}
            onClick={onRefClick}
            storageKey="rust-sa:graph-branches-open"
          />
          <RefSection
            title="tags"
            icon={TagIcon}
            refs={tags}
            base={base}
            head={head}
            onClick={onRefClick}
            storageKey="rust-sa:graph-tags-open"
          />
          <CommitList commits={commits} base={base} head={head} onRowClick={onRowClick} />
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
                  ? (base as 'WORKING' | 'STAGING')
                  : headIsSpecial && !baseIsSpecial
                    ? (head as 'WORKING' | 'STAGING')
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
  special: 'WORKING' | 'STAGING' | null
}) {
  const [treeWStr, setTreeWStr] = usePreference<string>('rust-sa:graph-tree-w', '280')
  const treeW = Number(treeWStr) || 280
  const { data, loading, error } = useQuery<{ files: PreviewFile[] }>(PREVIEW_FILES_QUERY, {
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
      <DiffView rev={rev} refreshKey={0} files={files} repo={repo} layout={layout} theme={theme} />
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
        {commit && <CommitMeta commit={commit} />}
        {body}
      </div>
    </div>
  )
}

function isSpecial(v: string | null): boolean {
  if (!v) return false
  const u = v.toUpperCase()
  return u === 'WORKING' || u === 'STAGING'
}

function specialLabel(id: string): string | null {
  const u = id.toUpperCase()
  if (u === 'WORKING') return 'working'
  if (u === 'STAGING') return 'staging'
  return null
}

const SPECIAL_DEFS = [
  {
    id: 'WORKING' as const,
    label: 'working',
    description: 'uncommitted (staged + unstaged) vs HEAD',
    icon: FilePen,
  },
  {
    id: 'STAGING' as const,
    label: 'staging',
    description: 'staged (index) vs HEAD',
    icon: CircleDot,
  },
]

function SpecialRows({
  base,
  head,
  onSelect,
}: {
  base: string | null
  head: string | null
  onSelect: (e: MouseEvent, id: 'WORKING' | 'STAGING') => void
}) {
  return (
    <div className="border-b border-hairline bg-amber-soft">
      {SPECIAL_DEFS.map(({ id, label, description, icon: Icon }) => {
        const isBase = base === id
        const isHead = head === id
        return (
          <button
            key={id}
            type="button"
            onClick={(e) => onSelect(e, id)}
            style={{ height: ROW_HEIGHT }}
            className={clsx(
              'w-full text-left flex items-center gap-2 pr-3 pl-3 font-mono text-xs cursor-pointer border-l-2',
              isBase
                ? 'bg-rust-soft border-l-rust'
                : isHead
                  ? 'bg-moss-soft border-l-moss'
                  : 'border-l-transparent hover:bg-amber/10',
            )}
          >
            <Icon size={14} aria-hidden="true" className="text-amber flex-shrink-0" />
            <span className="text-amber font-medium uppercase tracking-wider">{label}</span>
            <span className="text-mute flex-1 whitespace-nowrap overflow-hidden text-ellipsis">
              {description}
            </span>
            {isBase && <span className="text-rust uppercase tracking-wider">base</span>}
            {isHead && <span className="text-moss uppercase tracking-wider">head</span>}
          </button>
        )
      })}
    </div>
  )
}

function SpecialMeta({ special }: { special: 'WORKING' | 'STAGING' }) {
  const def = SPECIAL_DEFS.find((d) => d.id === special)!
  const Icon = def.icon
  return (
    <header className="px-5 pt-5 pb-4 border-b border-hairline bg-amber-soft">
      <div className="flex items-center gap-3 font-mono text-xs">
        <Icon size={16} aria-hidden="true" className="text-amber" />
        <span className="text-amber uppercase tracking-widest font-medium">{def.label}</span>
        <span className="text-mute">·</span>
        <span className="text-mute">{def.description}</span>
      </div>
      <h2 className="mt-2 m-0 font-serif text-xl tracking-tight text-ink">
        {special === 'WORKING' ? 'Working tree changes' : 'Staged changes'}
      </h2>
    </header>
  )
}

function RefSection({
  title,
  icon: Icon,
  refs,
  base,
  head,
  onClick,
  storageKey,
}: {
  title: string
  icon: typeof GitBranch
  refs: GitRef[]
  base: string | null
  head: string | null
  onClick: (e: MouseEvent, name: string) => void
  storageKey: string
}) {
  const [openStr, setOpenStr] = usePreference<string>(storageKey, 'false')
  const open = openStr === 'true'
  const [query, setQuery] = useState('')
  const [pendingFocus, setPendingFocus] = useState(false)
  const filterInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open && pendingFocus) {
      filterInputRef.current?.focus()
      setPendingFocus(false)
    }
  }, [open, pendingFocus])

  if (refs.length === 0) return null
  const filtered = query
    ? refs
        .map((r) => ({ ref: r, score: fuzzyScore(query, r.name) }))
        .filter((x) => x.score > 0)
        .toSorted((a, b) => b.score - a.score || a.ref.name.localeCompare(b.ref.name))
        .map((x) => x.ref)
    : refs
  const handleToggle = () => {
    const next = !open
    setOpenStr(next ? 'true' : 'false')
    if (next) setPendingFocus(true)
  }
  return (
    <div className="border-b border-hairline-soft">
      <button
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center gap-1.5 px-3 py-2 font-mono text-xs uppercase tracking-widest text-mute hover:text-ink hover:bg-bg-card cursor-pointer"
      >
        {open ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
        <Icon size={14} aria-hidden="true" />
        {title}
        <span className="ml-auto normal-case tracking-normal text-faint">{refs.length}</span>
      </button>
      {open && (
        <>
          {refs.length > 5 && (
            <SearchField
              value={query}
              onChange={setQuery}
              aria-label={`Filter ${title}`}
              className="group flex items-center gap-1.5 px-3 py-1.5 border-b border-hairline-soft font-mono text-xs text-mute"
            >
              <Search size={14} aria-hidden="true" className="text-faint flex-shrink-0" />
              <AriaInput
                ref={filterInputRef}
                placeholder={`filter ${title}…`}
                className="flex-1 bg-transparent text-ink outline-none placeholder:text-faint min-w-0"
              />
              <AriaButton
                slot="clear"
                aria-label="clear filter"
                className="group-data-[empty]:hidden text-faint hover:text-ink cursor-pointer inline-flex items-center"
              >
                <X size={14} aria-hidden="true" />
              </AriaButton>
              <span className="text-faint group-data-[empty]:hidden">{filtered.length}</span>
            </SearchField>
          )}
          {filtered.length === 0 && (
            <div className="px-3 py-2 font-mono text-xs text-mute">no matches</div>
          )}
          {filtered.map((r) => {
            const isBase = base === r.name
            const isHead = head === r.name
            return (
              <button
                key={r.name}
                type="button"
                onClick={(e) => onClick(e, r.name)}
                style={{ height: ROW_HEIGHT }}
                className={clsx(
                  'w-full text-left flex items-center gap-2 px-3 font-mono text-xs cursor-pointer border-l-2',
                  isBase
                    ? 'bg-rust-soft border-l-rust'
                    : isHead
                      ? 'bg-moss-soft border-l-moss'
                      : 'border-l-transparent hover:bg-bg-card',
                )}
              >
                <span className="text-ink truncate flex-1">{r.name}</span>
                {r.isCurrent && (
                  <span className="text-amber uppercase tracking-wider text-[10px]">HEAD</span>
                )}
                <span className="text-rust">{r.shortSha}</span>
                {isBase && <span className="text-rust uppercase tracking-wider">base</span>}
                {isHead && <span className="text-moss uppercase tracking-wider">head</span>}
              </button>
            )
          })}
        </>
      )}
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

function CommitMeta({ commit }: { commit: Commit }) {
  const refParts = commit.refs
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return (
    <header className="px-5 pt-5 pb-4 border-b border-hairline bg-bg">
      <div className="flex items-baseline gap-3 font-mono text-xs text-mute flex-wrap">
        <span className="text-rust">{commit.short}</span>
        <span>{commit.author}</span>
        <span>·</span>
        <span>{commit.when}</span>
      </div>
      <h2 className="mt-2 m-0 font-serif text-xl tracking-tight text-ink">{commit.message}</h2>
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
  onRowClick,
}: {
  commits: Commit[]
  base: string | null
  head: string | null
  onRowClick: (e: MouseEvent, sha: string) => void
}) {
  const nodes = layoutGraph(commits)
  const totalLanes = nodes.reduce(
    (max, n) =>
      Math.max(max, n.lane + 1, ...n.parentLanes.map((p) => p + 1), ...n.passing.map((p) => p + 1)),
    1,
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
          onClick={(e) => onRowClick(e, c.sha)}
        />
      ))}
    </>
  )
}

function CommitRow({
  commit,
  node,
  nextNode,
  totalLanes,
  isBase,
  isHead,
  onClick,
}: {
  commit: Commit
  node: GraphNode
  nextNode: GraphNode | undefined
  totalLanes: number
  isBase: boolean
  isHead: boolean
  onClick: (e: MouseEvent) => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ height: ROW_HEIGHT }}
      className={clsx(
        'w-full text-left flex items-center gap-2 pr-3 border-b border-hairline-soft font-mono text-xs cursor-pointer hover:bg-bg-card',
        isBase && 'bg-rust-soft',
        isHead && 'bg-moss-soft',
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
}

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
          <span className="text-faint font-normal">click</span>
        )}
      </span>
      <button
        type="button"
        onClick={onToggleThreeDot}
        aria-label={threeDot ? 'switch to two-dot' : 'switch to three-dot'}
        className="text-faint hover:text-ink cursor-pointer px-1 -mx-1 rounded-sm"
      >
        {threeDot ? '···' : '··'}
      </button>
      <span className="inline-flex items-center gap-1.5 text-ink">
        <span className="w-2 h-2 rounded-full inline-block bg-moss" />
        {head ? (
          (specialLabel(head) ?? shortSha(head))
        ) : (
          <span className="text-faint font-normal">⌃ / ⌘ + click</span>
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
