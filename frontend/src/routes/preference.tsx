import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { GitHubLink } from '#/components/github-link'
import { Segmented, SegmentedItem } from '#/components/ui/segmented'
import { usePreference, useRootAttribute } from '#/lib/preference'
import { useThemePreference } from '#/lib/server-preference'

export const Route = createFileRoute('/preference')({
  component: PreferencePage,
})

function PreferencePage() {
  const [theme, setTheme] = useThemePreference()
  const [density] = usePreference<'compact' | 'regular' | 'comfy'>('rust-sa:density', 'regular')
  useRootAttribute('data-theme', theme)
  useRootAttribute('data-density', density)

  return (
    <div className="min-h-full bg-bg text-ink overflow-y-auto">
      <header className="border-b border-hairline">
        <div className="max-w-4xl mx-auto px-8 h-[var(--topbar-h)] flex items-center gap-3">
          <Link
            to="/"
            aria-label="back to home"
            className="inline-flex items-center gap-1.5 text-mute hover:text-ink"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span className="font-mono text-xs">home</span>
          </Link>
          <span className="font-mono text-xs text-faint">·</span>
          <span className="font-mono text-sm font-medium text-ink">preferences</span>
          <GitHubLink />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-8 py-16 flex flex-col gap-12">
        <section className="flex flex-col gap-4">
          <h1 className="font-serif text-5xl leading-none tracking-tight font-normal m-0">
            Preferences.
          </h1>
          <p className="font-sans text-base text-mute leading-relaxed max-w-xl">
            Settings persist to{' '}
            <code className="font-mono text-rust">~/.config/sa/config.toml</code>.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <div className="font-mono text-xs uppercase tracking-widest text-mute">appearance</div>
          <Row
            label="theme"
            hint="light is warm-paper, dark inverts the palette."
            control={
              <Segmented
                aria-label="Theme"
                selectedKeys={[theme]}
                onSelectionChange={(keys) => {
                  const first = [...keys][0]
                  if (first === 'light' || first === 'dark') setTheme(first)
                }}
              >
                <SegmentedItem id="light">light</SegmentedItem>
                <SegmentedItem id="dark">dark</SegmentedItem>
              </Segmented>
            }
          />
        </section>
      </main>
    </div>
  )
}

function Row({ label, hint, control }: { label: string; hint?: string; control: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-4 border-b border-hairline-soft">
      <div className="flex flex-col gap-1 min-w-0">
        <span className="font-mono text-sm text-ink">{label}</span>
        {hint && <span className="font-sans text-xs text-mute">{hint}</span>}
      </div>
      <div className="flex-shrink-0">{control}</div>
    </div>
  )
}
