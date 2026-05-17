import { PatchDiff } from '@pierre/diffs/react'
import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { CommentComposer } from '#/components/comment-composer'
import { CommentThread } from '#/components/comment-thread'
import type { Comment, Side } from '#/lib/comments'
import { useDiff } from '#/lib/diff-api'

type PatchDiffProps = ComponentProps<typeof PatchDiff>
type RenderHeaderMetadata = PatchDiffProps['renderHeaderMetadata']
type RenderCustomHeader = PatchDiffProps['renderCustomHeader']
interface SelectedLineRange {
  start: number
  end: number
  side?: Side
  endSide?: Side
}

interface DiffViewFile {
  path: string
  additions?: number
  deletions?: number
}

interface AddCommentInput {
  path: string
  side: Side
  startLineNumber: number
  endLineNumber: number
  body: string
}

export interface DiffViewProps {
  rev: string
  refreshKey: number
  files: DiffViewFile[]
  repo: string
  initialPatches?: Record<string, string>
  layout?: 'unified' | 'split'
  theme?: 'light' | 'dark'
  className?: string
  comments?: Comment[]
  renderHeaderMetadata?: RenderHeaderMetadata
  onAddComment?: (input: AddCommentInput) => void
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
  repo: string
  additions: number
  deletions: number
  refreshKey: number
  initialPatch?: string
  layout: 'unified' | 'split'
  theme: 'light' | 'dark'
  comments?: Comment[]
  renderHeaderMetadata?: RenderHeaderMetadata
  onAddComment?: (input: AddCommentInput) => void
  onDeleteComment?: (id: string) => void
}

interface ComposingState {
  side: Side
  startLineNumber: number
  endLineNumber: number
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
  const { patch, loading, error } = useDiff(rev, repo, refreshKey, path, initialPatch)
  const reservedHeight = Math.max(240, (additions + deletions + 30) * 22)
  const [composing, setComposing] = useState<ComposingState | null>(null)
  const [composerBody, setComposerBody] = useState('')
  const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDocPointerDown = (e: PointerEvent) => {
      const eventPath = e.composedPath() as Element[]
      const insideContainer =
        containerRef.current != null && eventPath.includes(containerRef.current)
      const insideComposer = eventPath.some(
        (el) => el instanceof HTMLElement && el.hasAttribute('data-rust-sa-composer'),
      )
      const onGutterUtility = eventPath.some(
        (el) => el instanceof HTMLElement && el.hasAttribute('data-utility-button'),
      )
      if (composing && !insideComposer && !onGutterUtility && !composerBody.trim()) {
        setComposing(null)
        setComposerBody('')
      }
      if (selectedLines && !insideContainer) {
        setSelectedLines(null)
      }
    }
    document.addEventListener('pointerdown', onDocPointerDown, true)
    return () => document.removeEventListener('pointerdown', onDocPointerDown, true)
  }, [composing, composerBody, selectedLines])

  const onGutterUtilityClick = (range: SelectedLineRange) => {
    if (!onAddComment) return
    const side = (range.side ?? 'additions') as Side
    const [start, end] =
      range.start <= range.end ? [range.start, range.end] : [range.end, range.start]
    setComposing({ side, startLineNumber: start, endLineNumber: end })
    setComposerBody('')
  }

  const options: PatchDiffProps['options'] = {
    diffStyle: layout,
    theme: theme === 'dark' ? 'github-dark' : 'github-light',
    enableGutterUtility: true,
    enableLineSelection: true,
    onGutterUtilityClick,
    onLineSelectionStart: setSelectedLines,
    onLineSelectionChange: setSelectedLines,
    onLineSelectionEnd: setSelectedLines,
    onLineSelected: setSelectedLines,
  }

  const grouped = new Map<string, Comment[]>()
  for (const c of comments) {
    const key = `${c.side}:${c.startLineNumber}:${c.endLineNumber}`
    const arr = grouped.get(key) ?? []
    arr.push(c)
    grouped.set(key, arr)
  }
  const annotations = [
    ...[...grouped.entries()].map(([key, list]) => {
      const [side, , endLn] = key.split(':')
      return {
        side: side as Side,
        lineNumber: Number(endLn),
        metadata: { kind: 'thread' as const, comments: list },
      }
    }),
    ...(composing
      ? [
          {
            side: composing.side,
            lineNumber: composing.endLineNumber,
            metadata: { kind: 'composer' as const },
          },
        ]
      : []),
  ]

  const renderAnnotation = (ann: unknown) => {
    const m = (ann as { metadata?: unknown }).metadata
    if (!m || typeof m !== 'object') return null
    if ((m as { kind: string }).kind === 'thread') {
      const list = (m as { comments: Comment[] }).comments
      return <CommentThread comments={list} onDelete={onDeleteComment} />
    }
    if ((m as { kind: string }).kind === 'composer' && composing) {
      return (
        <CommentComposer
          startLineNumber={composing.startLineNumber}
          endLineNumber={composing.endLineNumber}
          value={composerBody}
          onChange={setComposerBody}
          onCancel={() => {
            setComposing(null)
            setComposerBody('')
          }}
          onSubmit={(body) => {
            onAddComment?.({
              path,
              side: composing.side,
              startLineNumber: composing.startLineNumber,
              endLineNumber: composing.endLineNumber,
              body,
            })
            setComposing(null)
            setComposerBody('')
          }}
        />
      )
    }
    return null
  }

  const wrapperStyle: React.CSSProperties = {
    minHeight: reservedHeight,
    contentVisibility: 'auto',
    containIntrinsicSize: `auto ${reservedHeight}px`,
  }

  if (loading && !patch) {
    return (
      <div
        className="px-4 py-3 font-mono text-xs text-mute border-b border-hairline-soft"
        style={wrapperStyle}
      >
        {path} — loading…
      </div>
    )
  }
  if (error) {
    return (
      <div className="px-4 py-3 font-mono text-xs text-crimson border-b border-hairline-soft">
        {path} — {error.message}
      </div>
    )
  }

  return (
    <div ref={containerRef} style={wrapperStyle} className="relative">
      <div className="sticky top-0 z-20 flex items-center gap-3 px-4 py-2 bg-bg border-b border-hairline">
        <span className="font-mono text-sm text-ink truncate">{path}</span>
        <span className="font-mono text-xs whitespace-nowrap">
          <span className="text-crimson">-{deletions}</span>
          <span className="text-faint"> </span>
          <span className="text-moss">+{additions}</span>
        </span>
        <span className="ml-auto">
          {renderHeaderMetadata?.({ name: path } as Parameters<
            NonNullable<RenderHeaderMetadata>
          >[0])}
        </span>
      </div>
      <PatchDiff
        patch={patch}
        options={options}
        lineAnnotations={annotations}
        selectedLines={selectedLines}
        renderCustomHeader={hideDefaultHeader}
        renderAnnotation={renderAnnotation}
      />
    </div>
  )
}

const hideDefaultHeader: NonNullable<RenderCustomHeader> = () => null
