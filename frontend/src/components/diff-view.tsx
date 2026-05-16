import { PatchDiff } from '@pierre/diffs/react'
import { useCallback, useMemo, useState, type ComponentProps } from 'react'
import { CommentComposer } from '#/components/comment-composer'
import { CommentThread } from '#/components/comment-thread'
import type { Comment, Side } from '#/lib/comments'
import { useDiff } from '#/lib/diff-api'

type PatchDiffProps = ComponentProps<typeof PatchDiff>
type RenderHeaderMetadata = PatchDiffProps['renderHeaderMetadata']
interface SelectedLineRange {
  start: number
  end: number
  side?: Side
  endSide?: Side
}

export interface DiffViewFile {
  path: string
  additions?: number
  deletions?: number
}

export interface DiffViewProps {
  rev: string
  refreshKey: number
  files: DiffViewFile[]
  repo?: string
  initialPatches?: Record<string, string>
  layout?: 'unified' | 'split'
  theme?: 'light' | 'dark'
  className?: string
  comments?: Comment[]
  renderHeaderMetadata?: RenderHeaderMetadata
  onAddComment?: (input: { path: string; side: Side; lineNumber: number; body: string }) => void
  onDeleteComment?: (id: string) => void
}

export function DiffView({
  rev,
  refreshKey,
  files,
  repo,
  initialPatches,
  layout = 'unified',
  theme = 'light',
  className,
  comments,
  renderHeaderMetadata,
  onAddComment,
  onDeleteComment,
}: DiffViewProps) {
  return (
    <div className={className}>
      {files.map((f) => (
        <FileBlock
          key={f.path}
          rev={rev}
          path={f.path}
          repo={repo}
          additions={f.additions ?? 0}
          deletions={f.deletions ?? 0}
          refreshKey={refreshKey}
          initialPatch={initialPatches?.[f.path]}
          layout={layout}
          theme={theme}
          comments={comments?.filter((c) => c.path === f.path)}
          renderHeaderMetadata={renderHeaderMetadata}
          onAddComment={onAddComment}
          onDeleteComment={onDeleteComment}
        />
      ))}
    </div>
  )
}

interface FileBlockProps {
  rev: string
  path: string
  repo?: string
  additions: number
  deletions: number
  refreshKey: number
  initialPatch?: string
  layout: 'unified' | 'split'
  theme: 'light' | 'dark'
  comments?: Comment[]
  renderHeaderMetadata?: RenderHeaderMetadata
  onAddComment?: (input: { path: string; side: Side; lineNumber: number; body: string }) => void
  onDeleteComment?: (id: string) => void
}

function FileBlock({
  rev,
  path,
  repo,
  additions,
  deletions,
  refreshKey,
  initialPatch,
  layout,
  theme,
  comments = [],
  renderHeaderMetadata,
  onAddComment,
  onDeleteComment,
}: FileBlockProps) {
  const { patch, loading, error } = useDiff(rev, refreshKey, path, initialPatch, repo)
  const reservedHeight = Math.max(240, (additions + deletions + 30) * 22)
  const [composing, setComposing] = useState<{ side: Side; lineNumber: number } | null>(null)

  const onGutterUtilityClick = useCallback(
    (range: SelectedLineRange) => {
      if (!onAddComment) return
      setComposing({ side: (range.side ?? 'additions') as Side, lineNumber: range.start })
    },
    [onAddComment],
  )

  const options = useMemo<PatchDiffProps['options']>(
    () => ({
      diffStyle: layout,
      theme: theme === 'dark' ? 'github-dark' : 'github-light',
      enableGutterUtility: true,
      onGutterUtilityClick,
    }),
    [layout, theme, onGutterUtilityClick],
  )

  const annotations = useMemo(() => {
    const grouped = new Map<string, Comment[]>()
    for (const c of comments) {
      const key = `${c.side}:${c.lineNumber}`
      const arr = grouped.get(key) ?? []
      arr.push(c)
      grouped.set(key, arr)
    }
    return [
      ...[...grouped.entries()].map(([key, list]) => {
        const [side, ln] = key.split(':')
        return {
          side: side as Side,
          lineNumber: Number(ln),
          metadata: { kind: 'thread' as const, comments: list },
        }
      }),
      ...(composing
        ? [
            {
              side: composing.side,
              lineNumber: composing.lineNumber,
              metadata: { kind: 'composer' as const },
            },
          ]
        : []),
    ]
  }, [comments, composing])

  const renderAnnotation = useCallback(
    (ann: unknown) => {
      const m = (ann as { metadata?: unknown }).metadata
      if (!m || typeof m !== 'object') return null
      if ((m as { kind: string }).kind === 'thread') {
        const list = (m as { comments: Comment[] }).comments
        return <CommentThread comments={list} onDelete={onDeleteComment} />
      }
      if ((m as { kind: string }).kind === 'composer' && composing) {
        return (
          <CommentComposer
            onCancel={() => setComposing(null)}
            onSubmit={(body) => {
              onAddComment?.({
                path,
                side: composing.side,
                lineNumber: composing.lineNumber,
                body,
              })
              setComposing(null)
            }}
          />
        )
      }
      return null
    },
    [composing, onAddComment, onDeleteComment, path],
  )

  const wrapperStyle: React.CSSProperties = {
    minHeight: reservedHeight,
    contentVisibility: 'auto',
    containIntrinsicSize: `auto ${reservedHeight}px`,
  }

  if (loading && !patch) {
    return (
      <div
        className="px-4 py-3 font-mono text-[12px] text-mute border-b border-hairline-soft"
        style={wrapperStyle}
      >
        {path} — loading…
      </div>
    )
  }
  if (error) {
    return (
      <div className="px-4 py-3 font-mono text-[12px] text-crimson border-b border-hairline-soft">
        {path} — {error.message}
      </div>
    )
  }

  return (
    <div style={wrapperStyle}>
      <PatchDiff
        patch={patch}
        options={options}
        lineAnnotations={annotations}
        renderHeaderMetadata={renderHeaderMetadata}
        renderAnnotation={renderAnnotation}
      />
    </div>
  )
}
