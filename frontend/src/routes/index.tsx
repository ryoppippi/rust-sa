import { useForm } from '@tanstack/react-form'
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
import { useEffect, useState } from 'react'
import { BrandMark } from '#/components/brand-mark'
import { FolderPicker } from '#/components/folder-picker'
import { GitHubLink } from '#/components/github-link'
import { Button } from '#/components/ui/button'
import { Kbd } from '#/components/ui/kbd'
import { usePreference, useRootAttribute } from '#/lib/preference'
import { useThemePreference } from '#/lib/server-preference'

export const Route = createFileRoute('/')({
  component: HomePage,
})

interface RecentEntry {
  repo: string
  spec?: string
  visitedAt: string
}

const RECENTS_KEY = 'rust-sa:recents'

function loadRecents(): RecentEntry[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(window.localStorage.getItem(RECENTS_KEY) ?? '[]') as RecentEntry[]
  } catch {
    return []
  }
}

function pushRecent(entry: RecentEntry): RecentEntry[] {
  const next = loadRecents().filter((r) => r.repo !== entry.repo)
  next.unshift(entry)
  const trimmed = next.slice(0, 8)
  window.localStorage.setItem(RECENTS_KEY, JSON.stringify(trimmed))
  return trimmed
}

function removeRecent(repo: string): RecentEntry[] {
  const next = loadRecents().filter((r) => r.repo !== repo)
  window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
  return next
}

function HomePage() {
  const navigate = useNavigate()
  const [theme] = useThemePreference()
  const [density] = usePreference<'compact' | 'regular' | 'comfy'>('rust-sa:density', 'regular')
  useRootAttribute('data-theme', theme)
  useRootAttribute('data-density', density)

  const [recents, setRecents] = useState<RecentEntry[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    setRecents(loadRecents())
  }, [])

  const goBrowse = (repo: string) => {
    setRecents(pushRecent({ repo, visitedAt: new Date().toISOString() }))
    navigate({ to: '/browse', search: { repo } })
  }

  const form = useForm({
    defaultValues: { repo: '' },
    onSubmit: ({ value }) => {
      const repo = value.repo.trim()
      if (!repo) return
      goBrowse(repo)
    },
  })

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
              form.handleSubmit()
            }}
          >
            <form.Field name="repo">
              {(field) => (
                <Field
                  label="repository"
                  hint="absolute path on disk (e.g. /home/you/ghq/github.com/owner/repo)"
                >
                  <div className="flex gap-2">
                    <input
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="/home/you/ghq/..."
                      className="flex-1 h-9 px-3 rounded-sm border border-hairline bg-bg font-mono text-xs text-ink outline-none focus:border-rust"
                      autoFocus
                    />
                    <Button variant="secondary" size="md" onPress={() => setPickerOpen(true)}>
                      <Folder size={16} aria-hidden="true" />
                      browse
                    </Button>
                  </div>
                </Field>
              )}
            </form.Field>
          </form>
        </section>

        {recents.length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="font-mono text-xs uppercase tracking-widest text-mute">recent</div>
            <ul className="flex flex-col border border-hairline rounded-sm divide-y divide-hairline-soft overflow-hidden">
              {recents.map((r) => (
                <li
                  key={`${r.repo}@${r.visitedAt}`}
                  className="group flex items-center hover:bg-bg-card"
                >
                  <button
                    type="button"
                    onClick={() => {
                      form.setFieldValue('repo', r.repo)
                      goBrowse(r.repo)
                    }}
                    className="flex-1 text-left px-3 py-2 font-mono text-xs flex items-center gap-3 cursor-pointer min-w-0"
                  >
                    <Eye size={14} aria-hidden="true" className="text-mute flex-shrink-0" />
                    <span className="text-ink-2 truncate">{r.repo}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecents(removeRecent(r.repo))}
                    aria-label={`Remove ${r.repo} from recents`}
                    className="p-1 text-faint hover:text-crimson cursor-pointer opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                  <span className="pl-2 pr-3 py-2 text-mute text-xs flex-shrink-0">
                    {timeAgo(r.visitedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="flex flex-col gap-4">
          <div className="font-mono text-xs uppercase tracking-widest text-mute">features</div>
          <div className="grid grid-cols-2 gap-4">
            <FeatureCard
              icon={<Eye size={16} aria-hidden="true" />}
              title="Repo Browser"
              path="/browse?repo=&lt;abs&gt;"
              body="Walk the working tree, click a file to read its content at HEAD with shiki-powered syntax highlighting. Blob fetches are cached so revisits are instant."
            />
            <FeatureCard
              icon={<GitGraph size={16} aria-hidden="true" />}
              title="Commit Graph"
              path="/graph?repo=&lt;abs&gt;"
              body="Commit log with sticky header & infinite scroll. Click / Ctrl-click / drag rows to pick base..head. WORKING / STAGING pseudos plus branches & tags as collapsible sections."
            />
            <FeatureCard
              icon={<FileDiff size={16} aria-hidden="true" />}
              title="Diff Reviewer"
              path="/compare/$spec?repo=&lt;abs&gt;"
              body="File tree, unified or split diff, file-level viewed state, inline comments with Copy Prompt, optional whitespace-ignore (?w=1), vim-flavoured keybindings."
            />
            <FeatureCard
              icon={<Palette size={16} aria-hidden="true" />}
              title="Design System"
              path="/design"
              body="Primitives, palette, type, and chrome rules. No repo required."
            />
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div className="font-mono text-xs uppercase tracking-widest text-mute">keybindings</div>
          <div className="grid grid-cols-2 gap-x-12 gap-y-2 max-w-xl">
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
        initialPath={form.state.values.repo.trim() || null}
        onPick={(path) => {
          form.setFieldValue('repo', path)
          goBrowse(path)
        }}
      />
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-xs uppercase tracking-widest text-mute">{label}</span>
      {children}
      {hint && <span className="font-mono text-xs text-faint">{hint}</span>}
    </label>
  )
}

function FeatureCard({
  icon,
  title,
  path,
  body,
}: {
  icon?: React.ReactNode
  title: string
  path: string
  body: string
}) {
  return (
    <article className="bg-bg-soft border border-hairline rounded-sm p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-rust">
        {icon}
        <h3 className="m-0 font-serif text-xl font-normal tracking-tight text-ink">{title}</h3>
      </div>
      <code className="font-mono text-xs text-rust" dangerouslySetInnerHTML={{ __html: path }} />
      <p className="m-0 font-sans text-sm text-ink-2 leading-relaxed">{body}</p>
    </article>
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
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}
