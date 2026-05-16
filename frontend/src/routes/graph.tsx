import { gql } from '@apollo/client'
import { useQuery } from '@apollo/client/react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, type MouseEvent } from 'react'
import { HelpSheet } from '#/components/help-sheet'
import { TopBar, type Mode, type Theme, type View } from '#/components/top-bar'
import { Button } from '#/components/ui/button'
import { Tag } from '#/components/ui/tag'
import { cn } from '#/lib/cn'
import { useKeybindings } from '#/lib/keybindings'
import { usePreference, useRootAttribute } from '#/lib/preference'

export const Route = createFileRoute('/graph')({
  component: GraphPage,
})

interface Commit {
  sha: string
  short: string
  message: string
  author: string
  when: string
  refs: string
}

const COMMITS_QUERY = gql`
  query Commits($limit: Int) {
    commits(limit: $limit) {
      sha
      short
      message
      author
      when
      refs
    }
  }
`

function GraphPage() {
  const navigate = useNavigate()
  const [mode, setMode] = usePreference<Mode>('rust-sa:mode', 'unified')
  const [theme, setTheme] = usePreference<Theme>('rust-sa:theme', 'light')
  const [density] = usePreference<'compact' | 'regular' | 'comfy'>(
    'rust-sa:density',
    'regular',
  )
  const [helpOpen, setHelpOpen] = useState(false)
  const [base, setBase] = useState<string | null>(null)
  const [head, setHead] = useState<string | null>(null)
  const [threeDot, setThreeDot] = useState(true)

  useRootAttribute('data-theme', theme)
  useRootAttribute('data-density', density)

  const { data, loading, error } = useQuery<{ commits: Commit[] }>(COMMITS_QUERY, {
    variables: { limit: 80 },
  })
  const commits = data?.commits ?? []

  useKeybindings({
    '?': () => setHelpOpen((o) => !o),
    s: () => setMode(mode === 'unified' ? 'split' : 'unified'),
  })

  const onRowClick = (e: MouseEvent, sha: string) => {
    if (e.shiftKey) setHead(sha)
    else setBase(sha)
  }

  const onViewChange = (next: View) => {
    if (next === 'diff') navigate({ to: '/diff' })
  }

  const openDiff = () => {
    if (!base) return
    const rev = head ? `${base}${threeDot ? '...' : '..'}${head}` : base
    navigate({ to: '/diff', search: { rev } })
  }

  return (
    <div className="grid grid-rows-[var(--topbar-h)_1fr] h-screen bg-bg text-ink">
      <TopBar
        base={base ?? '—'}
        head={head ?? '—'}
        separator={threeDot ? '···' : '··'}
        mode={mode}
        onModeChange={setMode}
        theme={theme}
        onThemeChange={setTheme}
        view="graph"
        onViewChange={onViewChange}
        viewedCount={0}
        totalCount={0}
        onHelp={() => setHelpOpen(true)}
      />
      <div className="border-t border-hairline grid grid-cols-[420px_1fr] min-h-0">
        <aside className="bg-bg-soft border-r border-hairline overflow-y-auto">
          <div className="px-4 pt-4 pb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-mute">
            commits
          </div>
          {loading && (
            <div className="px-4 py-2 font-mono text-[12px] text-mute">loading…</div>
          )}
          {error && (
            <div className="px-4 py-2 font-mono text-[12px] text-crimson">
              {error.message}
            </div>
          )}
          {commits.map((c) => (
            <CommitRow
              key={c.sha}
              commit={c}
              isBase={base === c.sha}
              isHead={head === c.sha}
              onClick={(e) => onRowClick(e, c.sha)}
            />
          ))}
        </aside>
        <main className="relative overflow-hidden bg-bg">
          <div className="absolute inset-0 flex items-center justify-center font-serif text-[36px] tracking-[-0.02em] text-faint">
            pick two commits.
          </div>
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

function CommitRow({
  commit,
  isBase,
  isHead,
  onClick,
}: {
  commit: Commit
  isBase: boolean
  isHead: boolean
  onClick: (e: MouseEvent) => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left flex items-center gap-2.5 px-3 py-2 border-b border-hairline-soft font-mono text-[12px] cursor-pointer hover:bg-bg-card',
        isBase && 'bg-[rgba(160,74,42,0.10)]',
        isHead && 'bg-[rgba(79,122,106,0.16)]',
      )}
    >
      <span className="text-rust">{commit.short}</span>
      <span className="text-ink flex-1 whitespace-nowrap overflow-hidden text-ellipsis">
        {commit.message}
      </span>
      {commit.refs && (
        <RefBadges refs={commit.refs} isBase={isBase} isHead={isHead} />
      )}
      <span className="text-mute text-[11px] flex-shrink-0">{commit.when}</span>
    </button>
  )
}

function RefBadges({
  refs,
  isBase,
  isHead,
}: {
  refs: string
  isBase: boolean
  isHead: boolean
}) {
  const parts = refs.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 2)
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
    <div className="absolute left-5 right-5 bottom-5 bg-bg border border-hairline rounded-[4px] px-5 py-4 font-mono text-[12.5px] flex items-center gap-4">
      <span className="text-[10.5px] uppercase tracking-[0.06em] text-mute">
        compare
      </span>
      <span className="inline-flex items-center gap-1.5 text-ink">
        <span className="w-2 h-2 rounded-full inline-block bg-rust" />
        {base ?? '—'}
      </span>
      <span className="text-faint">{threeDot ? '···' : '··'}</span>
      <span className="inline-flex items-center gap-1.5 text-ink">
        <span className="w-2 h-2 rounded-full inline-block bg-moss" />
        {head ?? '—'}
      </span>
      <Button variant="ghost" size="sm" onPress={onToggleThreeDot}>
        {threeDot ? 'three-dot' : 'two-dot'}
      </Button>
      <span className="flex-1" />
      <Button variant="ghost" size="sm" onPress={onClear}>
        clear
      </Button>
      <Button variant="primary" size="sm" onPress={onOpen} isDisabled={!base}>
        open diff
      </Button>
    </div>
  )
}
