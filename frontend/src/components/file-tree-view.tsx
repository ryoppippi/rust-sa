import { FileTree, useFileTree, useFileTreeSelection } from '@pierre/trees/react'
import type { GitStatusEntry } from '@pierre/trees'
import {
  useEffect,
  useRef,
  type ComponentProps,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react'
// a11y patches for the tree's shadow DOM are installed globally in __root.tsx.

export interface FileTreeViewProps {
  paths: string[]
  gitStatus?: readonly GitStatusEntry[]
  header?: ReactNode
  renderContextMenu?: ComponentProps<typeof FileTree>['renderContextMenu']
  style?: CSSProperties
  search?: boolean
  onSelectionChange?: (selectedPaths: readonly string[]) => void
  initialExpansion?: 'open' | 'closed' | number
}

const THEME_STYLE: CSSProperties = {
  height: '100%',
  paddingBlockStart: '8px',
  ['--trees-bg-override' as string]: 'var(--bg-soft)',
  ['--trees-fg-override' as string]: 'var(--ink)',
  ['--trees-fg-muted-override' as string]: 'var(--mute)',
  ['--trees-border-color-override' as string]: 'var(--hairline)',
  ['--trees-selected-bg-override' as string]: 'var(--bg-strong)',
  ['--trees-hover-bg-override' as string]: 'var(--bg-card)',
  ['--trees-muted-fg-override' as string]: 'var(--mute)',
  ['--trees-search-bg-override' as string]: 'var(--bg)',
  ['--trees-search-fg-override' as string]: 'var(--ink)',
  // Pierre defaults colour file names by git status (#16a994 added, #1ca1c7
  // modified, etc.) which fails WCAG 4.5:1 on our warm-paper backgrounds.
  // Pin every status colour to --moss/--rust/--crimson so contrast clears.
  ['--trees-git-added-color-override' as string]: 'var(--moss)',
  ['--trees-git-modified-color-override' as string]: 'var(--rust)',
  ['--trees-git-renamed-color-override' as string]: 'var(--rust)',
  ['--trees-git-untracked-color-override' as string]: 'var(--moss)',
  ['--trees-git-deleted-color-override' as string]: 'var(--crimson)',
  ['--trees-git-ignored-color-override' as string]: 'var(--mute)',
  ['--trees-status-added-override' as string]: 'var(--moss)',
  ['--trees-status-modified-override' as string]: 'var(--rust)',
  ['--trees-status-renamed-override' as string]: 'var(--rust)',
  ['--trees-status-untracked-override' as string]: 'var(--moss)',
  ['--trees-status-deleted-override' as string]: 'var(--crimson)',
  ['--trees-status-ignored-override' as string]: 'var(--mute)',
}

export function FileTreeView({
  paths,
  gitStatus,
  header,
  renderContextMenu,
  style,
  search = false,
  onSelectionChange,
  initialExpansion = 'open',
}: FileTreeViewProps) {
  const onSelectionChangeRef = useRef(onSelectionChange)
  onSelectionChangeRef.current = onSelectionChange
  const { model } = useFileTree({
    initialExpansion,
    onSelectionChange: (selection) => onSelectionChangeRef.current?.(selection),
    paths,
    search,
  })
  const selection = useFileTreeSelection(model)
  useEffect(() => {
    onSelectionChangeRef.current?.(selection)
  }, [selection])

  useEffect(() => {
    model.resetPaths(paths)
  }, [model, paths])

  useEffect(() => {
    model.setGitStatus(gitStatus)
  }, [model, gitStatus])

  const onTreeClickCapture = (event: MouseEvent<HTMLElement>) => {
    for (const node of event.nativeEvent.composedPath()) {
      if (!(node instanceof HTMLElement)) continue
      if (node.dataset.type !== 'item') continue
      if (node.dataset.itemType !== 'file') return
      const path = node.dataset.itemPath
      if (path) onSelectionChangeRef.current?.([path])
      return
    }
  }

  return (
    <FileTree
      model={model}
      header={header}
      renderContextMenu={renderContextMenu}
      onClickCapture={onTreeClickCapture}
      style={{ ...THEME_STYLE, ...style }}
    />
  )
}
