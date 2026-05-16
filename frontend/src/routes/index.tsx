import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '#/components/ui/button'
import { Kbd } from '#/components/ui/kbd'
import { usePreference, useRootAttribute } from '#/lib/preference'

export const Route = createFileRoute('/')({
  component: HomePage,
})

interface RecentEntry {
  repo: string
  spec: string
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
  const next = loadRecents().filter((r) => !(r.repo === entry.repo && r.spec === entry.spec))
  next.unshift(entry)
  const trimmed = next.slice(0, 8)
  window.localStorage.setItem(RECENTS_KEY, JSON.stringify(trimmed))
  return trimmed
}

function HomePage() {
  const navigate = useNavigate()
  const [theme] = usePreference<'light' | 'dark'>('rust-sa:theme', 'light')
  const [density] = usePreference<'compact' | 'regular' | 'comfy'>(
    'rust-sa:density',
    'regular',
  )
  useRootAttribute('data-theme', theme)
  useRootAttribute('data-density', density)

  const [repo, setRepo] = useState('')
  const [spec, setSpec] = useState('HEAD')
  const [recents, setRecents] = useState<RecentEntry[]>([])

  useEffect(() => {
    setRecents(loadRecents())
  }, [])

  const openCompare = (e?: FormEvent) => {
    e?.preventDefault()
    if (!repo.trim()) return
    setRecents(pushRecent({ repo: repo.trim(), spec: spec.trim() || 'HEAD', visitedAt: new Date().toISOString() }))
    navigate({ to: '/compare/$', params: { _splat: spec.trim() || 'HEAD' }, search: { repo: repo.trim() } })
  }

  const openGraph = () => {
    if (!repo.trim()) return
    setRecents(pushRecent({ repo: repo.trim(), spec: spec.trim() || 'HEAD', visitedAt: new Date().toISOString() }))
    navigate({ to: '/graph', search: { repo: repo.trim() } })
  }

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="border-b border-hairline">
        <div className="max-w-4xl mx-auto px-8 h-[var(--topbar-h)] flex items-center gap-3">
          <BrandMark />
          <span className="font-mono text-[13px] font-medium text-ink">rust-sa</span>
          <span className="ml-2 font-mono text-[11.5px] text-mute">local git diff reviewer</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-8 py-16 flex flex-col gap-16">
        <section className="flex flex-col gap-4">
          <h1 className="font-serif text-[56px] leading-none tracking-[-0.02em] font-normal m-0">
            Review your local diff.
          </h1>
          <p className="font-sans text-[15px] text-mute leading-relaxed max-w-[560px]">
            Point rust-sa at a repository on disk, pick a rev or range, and
            review the patch with file tree, comments, viewed state, and
            keyboard navigation.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-mute">open</div>
          <form className="flex flex-col gap-3" onSubmit={openCompare}>
            <Field
              label="repository"
              hint="absolute path on disk (e.g. /home/you/ghq/github.com/owner/repo)"
            >
              <input
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="/home/you/ghq/..."
                className="w-full h-9 px-3 rounded-[3px] border border-hairline bg-bg font-mono text-[12.5px] text-ink outline-none focus:border-rust"
                autoFocus
              />
            </Field>
            <Field label="spec" hint="git ref / range. e.g. HEAD · HEAD~3...HEAD · main..feature">
              <input
                value={spec}
                onChange={(e) => setSpec(e.target.value)}
                placeholder="HEAD"
                className="w-full h-9 px-3 rounded-[3px] border border-hairline bg-bg font-mono text-[12.5px] text-ink outline-none focus:border-rust"
              />
            </Field>
            <div className="flex items-center gap-2 mt-1">
              <Button type="submit" variant="primary" isDisabled={!repo.trim()}>
                open diff
              </Button>
              <Button variant="secondary" onPress={openGraph} isDisabled={!repo.trim()}>
                open graph
              </Button>
            </div>
          </form>
        </section>

        {recents.length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-mute">
              recent
            </div>
            <ul className="flex flex-col gap-1 border border-hairline rounded-[3px] divide-y divide-hairline-soft">
              {recents.map((r) => (
                <li key={`${r.repo}@${r.spec}@${r.visitedAt}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setRepo(r.repo)
                      setSpec(r.spec)
                      navigate({
                        to: '/compare/$',
                        params: { _splat: r.spec },
                        search: { repo: r.repo },
                      })
                    }}
                    className="w-full text-left px-3 py-2 font-mono text-[12px] hover:bg-bg-card flex items-center gap-3 cursor-pointer"
                  >
                    <span className="text-rust">{r.spec}</span>
                    <span className="text-ink-2 truncate">{r.repo}</span>
                    <span className="ml-auto text-mute text-[10.5px]">{timeAgo(r.visitedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="flex flex-col gap-4">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-mute">
            features
          </div>
          <div className="grid grid-cols-3 gap-4">
            <FeatureCard
              title="Diff Reviewer"
              path="/compare/$spec?repo=&lt;abs&gt;"
              body="File tree, multi-file unified or split diff, file-level viewed state, inline comments with Copy Prompt, vim-flavoured keybindings."
            />
            <FeatureCard
              title="Compare Picker"
              path="/graph?repo=&lt;abs&gt;"
              body="Commit log with click-to-set-base / shift-click-to-set-head, three/two-dot toggle, open the range as /compare."
            />
            <FeatureCard
              title="Design System"
              path="/design"
              body="Primitives, palette, type, and chrome rules. No repo required."
            />
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-mute">
            keybindings
          </div>
          <div className="grid grid-cols-2 gap-x-12 gap-y-2 max-w-[600px]">
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
        <div className="max-w-4xl mx-auto px-8 py-6 font-mono text-[11px] text-mute flex items-center justify-between">
          <span>rust-sa · local git diff reviewer</span>
          <a
            href="https://github.com/conao3/rust-sa"
            className="text-rust hover:text-rust-deep"
            target="_blank"
            rel="noreferrer"
          >
            github.com/conao3/rust-sa
          </a>
        </div>
      </footer>
    </div>
  )
}

function BrandMark() {
  return (
    <span className="inline-flex items-center gap-[2px]" aria-hidden="true">
      <i className="inline-block w-1 h-[14px] bg-rust" />
      <i className="inline-block w-1 h-[14px] bg-ink mt-1" />
      <i className="inline-block w-1 h-[14px] bg-rust opacity-50 -mt-1" />
    </span>
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
      <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-mute">{label}</span>
      {children}
      {hint && <span className="font-mono text-[10.5px] text-faint">{hint}</span>}
    </label>
  )
}

function FeatureCard({ title, path, body }: { title: string; path: string; body: string }) {
  return (
    <article className="bg-bg-soft border border-hairline rounded-[3px] p-4 flex flex-col gap-2">
      <h3 className="m-0 font-serif text-[20px] font-normal tracking-[-0.01em]">{title}</h3>
      <code className="font-mono text-[11px] text-rust" dangerouslySetInnerHTML={{ __html: path }} />
      <p className="m-0 font-sans text-[13px] text-ink-2 leading-relaxed">{body}</p>
    </article>
  )
}

function KeyRow({ keys, action }: { keys: string[]; action: string }) {
  return (
    <div className="flex items-center justify-between text-[13px] text-ink-2">
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
