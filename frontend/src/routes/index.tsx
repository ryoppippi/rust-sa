import { useMutation, useQuery } from '#/lib/typed-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  ExternalLink,
  Eye,
  FileDiff,
  Folder,
  GitFork,
  GitGraph,
  Palette,
  Settings,
  Trash2,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { BrandMark } from '#/components/brand-mark'
import { FolderPicker } from '#/components/folder-picker'
import { GitHubLink } from '#/components/github-link'
import { Button } from '#/components/ui/button'
import { Kbd } from '#/components/ui/kbd'
import { RepoComboBox, type RepoOption } from '#/components/ui/repo-combobox'
import {
  HomeDataDocument,
  RecordRecentDocument,
  RemoveRecentDocument,
  ValidateRepoDocument,
} from '#/graphql/generated/graphql'
import { executeGraphQL } from '#/lib/apollo'
import { usePreference, useRootAttribute } from '#/lib/preference'
import { useThemePreference } from '#/lib/server-preference'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  const navigate = useNavigate()
  const [theme] = useThemePreference()
  const [density] = usePreference<'compact' | 'regular' | 'comfy'>('rust-sa:density', 'regular')
  useRootAttribute('data-theme', theme)
  useRootAttribute('data-density', density)

  const inputRef = useRef<HTMLInputElement>(null)
  const [repoValue, setRepoValue] = useState('')
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const { data, loading, refetch } = useQuery(HomeDataDocument, {
    variables: { limit: 200 },
    fetchPolicy: 'cache-and-network',
  })
  const [recordRecent] = useMutation(RecordRecentDocument)
  const [removeRecent] = useMutation(RemoveRecentDocument)
  const recents = data?.recents ?? []
  const discovered = data?.repoCandidates ?? []
  const recentOptions: RepoOption[] = recents.map((entry) => ({
    path: entry.repo,
    spec: entry.spec,
    source: 'recent',
  }))
  const discoveredOptions: RepoOption[] = discovered.map((entry) => ({
    path: entry.path,
    source: 'discovered',
  }))
  const topRecent = recents[0]

  const record = async (repo: string, spec?: string) => {
    await recordRecent({ variables: { repo, spec } })
    await refetch()
  }

  const openCompare = async (repo: string, spec = 'WORKING') => {
    await record(repo, spec)
    navigate({ to: '/compare/$', params: { _splat: spec }, search: { repo } })
  }

  const submitRepo = async (repo: string) => {
    const raw = repo.trim()
    if (!raw || submitting) return
    setSubmitting(true)
    setInlineError(null)
    try {
      const validation = await executeGraphQL(ValidateRepoDocument, { repo: raw })
      if (!validation.validateRepo.ok || !validation.validateRepo.path) {
        setInlineError(validation.validateRepo.message ?? 'not a git repository')
        return
      }
      setRepoValue(validation.validateRepo.path)
      await openCompare(validation.validateRepo.path)
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async (repo: string) => {
    await removeRecent({ variables: { repo } })
    await refetch()
  }

  const focusRepo = () => inputRef.current?.focus()

  return (
    <div className="min-h-full bg-bg text-ink overflow-y-auto">
      <header className="border-b border-hairline">
        <div className="max-w-4xl mx-auto px-8 h-[var(--topbar-h)] flex items-center gap-3">
          <BrandMark />
          <span className="font-mono text-sm font-medium text-ink">rust-sa</span>
          <GitHubLink />
          <span className="ml-2 font-mono text-xs text-mute">local git diff reviewer</span>
          <Link
            to="/preference"
            className="ml-auto inline-flex items-center gap-1.5 font-mono text-xs text-mute hover:text-ink"
          >
            <Settings size={16} aria-hidden="true" />
            preferences
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-8 py-16 flex flex-col gap-16">
        <section className="flex flex-col gap-4">
          <h1 className="font-serif text-6xl leading-none tracking-tight font-normal m-0">
            Review your local diff.
          </h1>
          <p className="font-sans text-base text-mute leading-relaxed max-w-xl">
            Point rust-sa at a repository on disk, pick a rev or range, and review the patch with
            file tree, comments, viewed state, and keyboard navigation.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <div className="font-mono text-xs uppercase tracking-widest text-mute">open</div>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              e.stopPropagation()
              void submitRepo(repoValue)
            }}
          >
            <Field
              label="repository"
              hint={
                loading
                  ? 'loading repository candidates…'
                  : 'type to filter recent and discovered git repositories, or enter a custom path'
              }
              error={inlineError}
            >
              <div className="flex gap-2">
                <RepoComboBox
                  value={repoValue}
                  onChange={(value) => {
                    setRepoValue(value)
                    setInlineError(null)
                  }}
                  recentOptions={recentOptions}
                  discoveredOptions={discoveredOptions}
                  inputRef={inputRef}
                  error={inlineError}
                />
                <Button variant="secondary" size="md" onPress={() => setPickerOpen(true)}>
                  <Folder size={16} aria-hidden="true" />
                  browse
                </Button>
                <Button variant="primary" size="md" type="submit" isDisabled={submitting}>
                  <FileDiff size={16} aria-hidden="true" />
                  {submitting ? 'opening' : 'open diff'}
                </Button>
              </div>
            </Field>
          </form>
        </section>

        <section className="flex flex-col gap-3">
          <div className="font-mono text-xs uppercase tracking-widest text-mute">recent</div>
          {recents.length > 0 ? (
            <ul className="flex flex-col border border-hairline rounded-sm divide-y divide-hairline-soft overflow-hidden">
              {recents.map((entry) => (
                <li
                  key={`${entry.repo}@${entry.visitedAt}`}
                  className="group flex items-center hover:bg-bg-card"
                >
                  <button
                    type="button"
                    onClick={() => void openCompare(entry.repo, entry.spec ?? 'WORKING')}
                    className="flex-1 text-left px-3 py-2 font-mono text-xs flex items-center gap-3 cursor-pointer min-w-0"
                  >
                    <Eye size={14} aria-hidden="true" className="text-mute flex-shrink-0" />
                    <span className="text-ink-2 truncate">{entry.repo}</span>
                    <span className="text-faint flex-shrink-0">{entry.spec ?? 'WORKING'}</span>
                  </button>
                  <RecentLinks repo={entry.repo} spec={entry.spec ?? 'WORKING'} />
                  <button
                    type="button"
                    onClick={() => void remove(entry.repo)}
                    aria-label={`Remove ${entry.repo} from recents`}
                    className="p-1 text-faint hover:text-crimson cursor-pointer opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                  <span className="pl-2 pr-3 py-2 text-mute text-xs flex-shrink-0">
                    {timeAgo(entry.visitedAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="border border-dashed border-hairline rounded-sm px-4 py-5 font-mono text-xs text-mute leading-relaxed">
              Start typing in the repository box. It filters repositories from your history and from
              the discovered ghq tree; custom absolute paths still work.
            </div>
          )}
        </section>

        <section className="flex flex-col gap-4">
          <div className="font-mono text-xs uppercase tracking-widest text-mute">features</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FeatureCard
              icon={<Eye size={16} aria-hidden="true" />}
              title="Repo Browser"
              path="/browse?repo=&lt;abs&gt;"
              body="Walk the working tree, click a file to read its content at HEAD with shiki-powered syntax highlighting. Blob fetches are cached so revisits are instant."
              repo={topRecent?.repo}
              onActivate={(repo) => navigate({ to: '/browse', search: { repo } })}
              onMissingRepo={focusRepo}
            />
            <FeatureCard
              icon={<GitGraph size={16} aria-hidden="true" />}
              title="Commit Graph"
              path="/graph?repo=&lt;abs&gt;"
              body="Commit log with sticky header & infinite scroll. Click / Ctrl-click / drag rows to pick base..head. WORKING / STAGING pseudos plus branches & tags as collapsible sections."
              repo={topRecent?.repo}
              onActivate={(repo) => navigate({ to: '/graph', search: { repo } })}
              onMissingRepo={focusRepo}
            />
            <FeatureCard
              icon={<FileDiff size={16} aria-hidden="true" />}
              title="Diff Reviewer"
              path="/compare/$spec?repo=&lt;abs&gt;"
              body="File tree, unified or split diff, file-level viewed state, inline comments with Copy Prompt, optional whitespace-ignore (?w=1), vim-flavoured keybindings."
              repo={topRecent?.repo}
              onActivate={(repo) =>
                navigate({
                  to: '/compare/$',
                  params: { _splat: topRecent?.spec ?? 'WORKING' },
                  search: { repo },
                })
              }
              onMissingRepo={focusRepo}
            />
            <FeatureCard
              icon={<Palette size={16} aria-hidden="true" />}
              title="Design System"
              path="/design"
              body="Primitives, palette, type, and chrome rules. No repo required."
              onActivate={() => navigate({ to: '/design' })}
              onMissingRepo={focusRepo}
              requiresRepo={false}
            />
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div className="font-mono text-xs uppercase tracking-widest text-mute">keybindings</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-2 max-w-xl">
            <KeyRow keys={['?']} action="toggle keybinding sheet" />
            <KeyRow keys={['s']} action="toggle unified / split" />
            <KeyRow keys={['.']} action="cycle density" />
            <KeyRow keys={['v']} action="toggle viewed on current file" />
            <KeyRow keys={['[', ']']} action="prev / next file" />
            <KeyRow keys={['g']} action="jump to commit graph" />
          </div>
        </section>
      </main>

      <footer className="border-t border-hairline mt-16">
        <div className="max-w-4xl mx-auto px-8 py-6 font-mono text-xs text-mute flex items-center justify-between">
          <span>rust-sa · local git diff reviewer</span>
          <a
            href="https://github.com/conao3/rust-sa"
            className="inline-flex items-center gap-1 text-rust hover:text-rust-deep"
            target="_blank"
            rel="noreferrer"
          >
            <GitFork size={16} aria-hidden="true" />
            github.com/conao3/rust-sa
            <ExternalLink size={16} aria-hidden="true" />
          </a>
        </div>
      </footer>
      <FolderPicker
        isOpen={pickerOpen}
        onOpenChange={setPickerOpen}
        initialPath={repoValue.trim() || null}
        onPick={(path) => {
          setRepoValue(path)
          void submitRepo(path)
        }}
      />
    </div>
  )
}

function RecentLinks({ repo, spec }: { repo: string; spec: string }) {
  return (
    <div className="hidden sm:flex items-center gap-1 pr-2">
      <Link
        to="/compare/$"
        params={{ _splat: spec }}
        search={{ repo }}
        className="px-2 py-1 rounded-sm font-mono text-xs text-mute hover:bg-rust-soft hover:text-rust"
      >
        diff
      </Link>
      <Link
        to="/browse"
        search={{ repo }}
        className="px-2 py-1 rounded-sm font-mono text-xs text-mute hover:bg-rust-soft hover:text-rust"
      >
        browse
      </Link>
      <Link
        to="/graph"
        search={{ repo }}
        className="px-2 py-1 rounded-sm font-mono text-xs text-mute hover:bg-rust-soft hover:text-rust"
      >
        graph
      </Link>
    </div>
  )
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string | null
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-xs uppercase tracking-widest text-mute">{label}</span>
      {children}
      {error ? (
        <span className="font-mono text-xs text-crimson">{error}</span>
      ) : (
        hint && <span className="font-mono text-xs text-faint">{hint}</span>
      )}
    </label>
  )
}

function FeatureCard({
  icon,
  title,
  path,
  body,
  repo,
  onActivate,
  onMissingRepo,
  requiresRepo = true,
}: {
  icon?: React.ReactNode
  title: string
  path: string
  body: string
  repo?: string
  onActivate: (repo: string) => void
  onMissingRepo: () => void
  requiresRepo?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => (requiresRepo ? (repo ? onActivate(repo) : onMissingRepo()) : onActivate(''))}
      className="text-left bg-bg-soft border border-hairline rounded-sm p-4 flex flex-col gap-2 hover:bg-bg-card hover:border-rust cursor-pointer"
    >
      <div className="flex items-center gap-2 text-rust">
        {icon}
        <h3 className="m-0 font-serif text-xl font-normal tracking-tight text-ink">{title}</h3>
      </div>
      <code className="font-mono text-xs text-rust" dangerouslySetInnerHTML={{ __html: path }} />
      <p className="m-0 font-sans text-sm text-ink-2 leading-relaxed">{body}</p>
      {requiresRepo && !repo && (
        <span className="font-mono text-xs text-faint">select a repo first</span>
      )}
    </button>
  )
}

function KeyRow({ keys, action }: { keys: string[]; action: string }) {
  return (
    <div className="flex items-center justify-between text-sm text-ink-2">
      <span>{action}</span>
      <span className="inline-flex gap-1">
        {keys.map((k, i) => (
          <Kbd key={i}>{k}</Kbd>
        ))}
      </span>
    </div>
  )
}

function timeAgo(iso: string): string {
  const value = /^\d+$/.test(iso) ? Number(iso) : new Date(iso).getTime()
  const sec = Math.floor((Date.now() - value) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}
