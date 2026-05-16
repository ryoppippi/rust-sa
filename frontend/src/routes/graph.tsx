import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { HelpSheet } from '#/components/help-sheet'
import { TopBar, type Mode, type Theme, type View } from '#/components/top-bar'
import { usePreference, useRootAttribute } from '#/lib/preference'

export const Route = createFileRoute('/graph')({
  component: GraphPage,
})

function GraphPage() {
  const navigate = useNavigate()
  const [mode, setMode] = usePreference<Mode>('rust-sa:mode', 'unified')
  const [theme, setTheme] = usePreference<Theme>('rust-sa:theme', 'light')
  const [density] = usePreference<'compact' | 'regular' | 'comfy'>(
    'rust-sa:density',
    'regular',
  )
  const [helpOpen, setHelpOpen] = useState(false)

  useRootAttribute('data-theme', theme)
  useRootAttribute('data-density', density)

  const onViewChange = (next: View) => {
    if (next === 'diff') navigate({ to: '/diff' })
  }

  return (
    <div className="grid grid-rows-[var(--topbar-h)_1fr] h-screen bg-bg text-ink">
      <TopBar
        base="main"
        head="working"
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
      <div className="border-t border-hairline grid grid-cols-[360px_1fr] min-h-0">
        <aside className="bg-bg-soft border-r border-hairline overflow-y-auto">
          <div className="p-4 font-mono text-[11px] uppercase tracking-[0.08em] text-mute">
            commits
          </div>
          <div className="px-4 pb-4 font-mono text-[12px] text-mute">
            commit graph + compare picker coming in phase 2.
          </div>
        </aside>
        <main className="relative overflow-hidden bg-bg flex items-center justify-center font-serif text-[24px] tracking-[-0.01em] text-mute">
          pick two commits.
        </main>
      </div>
      <HelpSheet isOpen={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  )
}
