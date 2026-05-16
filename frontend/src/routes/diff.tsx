import { gql } from '@apollo/client'
import { useQuery } from '@apollo/client/react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { DiffView } from '#/components/diff-view'
import { FileTreeView } from '#/components/file-tree-view'
import { HelpSheet } from '#/components/help-sheet'
import { TopBar, type Mode, type Theme, type View } from '#/components/top-bar'
import { ViewedCheck } from '#/components/ui/viewed-check'
import { pathFromPatch, splitPatchByFile, statusFromPatch } from '#/lib/parse-patch'
import { usePreference, useRootAttribute } from '#/lib/preference'
import { useViewed } from '#/lib/viewed'

export const Route = createFileRoute('/diff')({
  component: DiffPage,
})

const DIFF_QUERY = gql`
  query Diff($rev: String!) {
    diff(rev: $rev)
  }
`

function DiffPage() {
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
    if (next === 'graph') navigate({ to: '/graph' })
  }

  const rev = 'HEAD'
  const { data, loading, error } = useQuery<{ diff: string }>(DIFF_QUERY, {
    variables: { rev },
  })
  const patch = data?.diff ?? ''
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

  return (
    <div className="grid grid-rows-[var(--topbar-h)_1fr] h-screen bg-bg text-ink">
      <TopBar
        base="main"
        head="working"
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
              renderHeaderMetadata={(file) => (
                <ViewedCheck
                  isOn={isViewed(file.name)}
                  onToggle={() => toggle(file.name)}
                />
              )}
            />
          )}
        </main>
      </div>
      <HelpSheet isOpen={helpOpen} onOpenChange={setHelpOpen} />
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
