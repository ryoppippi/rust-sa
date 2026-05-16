import { PatchDiff } from '@pierre/diffs/react'
import { useCallback, useMemo, useState, type ComponentProps } from 'react'
import { CommentComposer } from '#/components/comment-composer'
import { CommentThread } from '#/components/comment-thread'
import type { Comment, Side } from '#/lib/comments'
import { pathFromPatch, splitPatchByFile } from '#/lib/parse-patch'

type PatchDiffProps = ComponentProps<typeof PatchDiff>
type RenderHeaderMetadata = PatchDiffProps['renderHeaderMetadata']
interface SelectedLineRange {
  start: number
  end: number
  side?: Side
  endSide?: Side
}

export interface DiffViewProps {
  patch: string
  layout?: 'unified' | 'split'
  theme?: 'light' | 'dark'
  className?: string
  comments?: Comment[]
  renderHeaderMetadata?: RenderHeaderMetadata
  onAddComment?: (input: { path: string; side: Side; lineNumber: number; body: string }) => void
  onDeleteComment?: (id: string) => void
}

export function DiffView({
  patch,
  layout = 'unified',
  theme = 'light',
  className,
  comments,
  renderHeaderMetadata,
  onAddComment,
  onDeleteComment,
}: DiffViewProps) {
  const files = splitPatchByFile(patch)
  return (
    <div className={className}>
      {files.map((filePatch) => (
        <FileBlock
          key={pathFromPatch(filePatch)}
          filePatch={filePatch}
          layout={layout}
          theme={theme}
          comments={comments?.filter((c) => c.path === pathFromPatch(filePatch))}
          renderHeaderMetadata={renderHeaderMetadata}
          onAddComment={onAddComment}
          onDeleteComment={onDeleteComment}
        />
      ))}
    </div>
  )
}

interface FileBlockProps {
  filePatch: string
  layout: 'unified' | 'split'
  theme: 'light' | 'dark'
  comments?: Comment[]
  renderHeaderMetadata?: RenderHeaderMetadata
  onAddComment?: (input: { path: string; side: Side; lineNumber: number; body: string }) => void
  onDeleteComment?: (id: string) => void
}

function FileBlock({
  filePatch,
  layout,
  theme,
  comments = [],
  renderHeaderMetadata,
  onAddComment,
  onDeleteComment,
}: FileBlockProps) {
  const path = pathFromPatch(filePatch)
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

  return (
    <PatchDiff
      patch={filePatch}
      options={options}
      lineAnnotations={annotations}
      renderHeaderMetadata={renderHeaderMetadata}
      renderAnnotation={renderAnnotation}
    />
  )
}
