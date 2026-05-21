import { processFile, type FileDiffMetadata } from '@pierre/diffs'
import { FileDiff, PatchDiff } from '@pierre/diffs/react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { CommentComposer } from '#/components/comment-composer'
import { CommentThread } from '#/components/comment-thread'
import { ViewedCheck } from '#/components/ui/viewed-check'
import type { Comment, Side } from '#/lib/comments'
import { useDiff, useFileBlobs } from '#/lib/diff-api'

type PatchDiffProps = ComponentProps<typeof PatchDiff>
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
  /** Row count the unified-mode renderer will paint. */
  visibleLines?: number
  /** Row count the split-mode renderer will paint (paired add/del rows share
   * a single visual row). The active layout picks one of the two. */
  visibleLinesSplit?: number
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
  isViewed?: (path: string) => boolean
  onToggleViewed?: (path: string) => void
  onAddComment?: (input: AddCommentInput) => void
  onDeleteComment?: (id: string) => void
  ignoreWhitespace?: boolean
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
  isViewed,
  onToggleViewed,
  onAddComment,
  onDeleteComment,
  ignoreWhitespace,
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
          visibleLines={f.visibleLines}
          visibleLinesSplit={f.visibleLinesSplit}
          refreshKey={refreshKey}
          initialPatch={initialPatches?.[f.path]}
          layout={layout}
          theme={theme}
          comments={comments?.filter((c) => c.path === f.path)}
          viewed={isViewed?.(f.path) ?? false}
          onToggleViewed={onToggleViewed ? () => onToggleViewed(f.path) : undefined}
          onAddComment={onAddComment}
          onDeleteComment={onDeleteComment}
          ignoreWhitespace={ignoreWhitespace}
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
  visibleLines?: number
  visibleLinesSplit?: number
  refreshKey: number
  initialPatch?: string
  layout: 'unified' | 'split'
  theme: 'light' | 'dark'
  comments?: Comment[]
  viewed: boolean
  onToggleViewed?: () => void
  onAddComment?: (input: AddCommentInput) => void
  onDeleteComment?: (id: string) => void
  ignoreWhitespace?: boolean
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
  visibleLines,
  visibleLinesSplit,
  refreshKey,
  initialPatch,
  layout,
  theme,
  comments = [],
  viewed,
  onToggleViewed,
  onAddComment,
  onDeleteComment,
  ignoreWhitespace,
}: FileBlockProps) {
  const { patch, loading, error } = useDiff(
    rev,
    repo,
    refreshKey,
    path,
    initialPatch,
    ignoreWhitespace,
  )
  const blobs = useFileBlobs(rev, repo, path, refreshKey)
  const fileDiff = useMemo<FileDiffMetadata | undefined>(() => {
    if (!patch || !blobs.available || blobs.error) return undefined
    try {
      return processFile(patch, {
        isGitDiff: true,
        oldFile: { name: path, contents: blobs.oldText ?? '' },
        newFile: { name: path, contents: blobs.newText ?? '' },
      })
    } catch {
      return undefined
    }
  }, [patch, blobs.available, blobs.error, blobs.oldText, blobs.newText, path])
  // visibleLines / visibleLinesSplit come from the backend's parse of the
  // unified diff and match pierre/diffs' row count for each mode to within
  // ±1. The active layout decides which one we reserve against. Fall back to
  // a generous additions+deletions estimate only when neither field is
  // present (older API).
  const visibleForLayout = layout === 'split' ? visibleLinesSplit : visibleLines
  const reservedHeight =
    visibleForLayout != null
      ? Math.max(80, visibleForLayout * LINE_HEIGHT + FILE_HEADER_HEIGHT)
      : Math.max(240, (additions + deletions + 30) * 22)
  const [composing, setComposing] = useState<ComposingState | null>(null)
  const [composerBody, setComposerBody] = useState('')
  const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(null)
  const [collapsed, setCollapsed] = useState(viewed)
  const containerRef = useRef<HTMLDivElement>(null)
  // Virtual-scroll the diff list: only blocks within VIRTUAL_MARGIN of the
  // viewport stay mounted. Everything else collapses to a placeholder div of
  // the same reserved height, removing the diff DOM, pierre's shadow root,
  // and the shiki tokenisation cost. SSR mounts every block (no IO on
  // server) so the initial paint hydrates with content in place.
  const [inRange, setInRange] = useState(true)
  const [stableHeight, setStableHeight] = useState<number | null>(null)

  const handleToggleViewed = () => {
    setCollapsed(!viewed)
    onToggleViewed?.()
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) return
        setInRange(entry.isIntersecting)
      },
      { rootMargin: `${VIRTUAL_MARGIN_PX}px 0px` },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Remember the rendered height so that when we unmount the content the
  // placeholder doesn't shrink and shift everything below it upward.
  useEffect(() => {
    if (!inRange) return
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return
      const h = entry.contentRect.height
      if (h > 0) setStableHeight((prev) => (prev != null && prev > h ? prev : h))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [inRange])

  useEffect(() => {
    if (loading || error || collapsed) return
    const sheet = getDiffsScrollbarSheet()
    if (!sheet) return
    const adopt = () => {
      const container = containerRef.current?.querySelector('diffs-container')
      const root = container?.shadowRoot
      if (!root) return false
      if (root.adoptedStyleSheets.includes(sheet)) return true
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
      return true
    }
    if (adopt()) return
    const id = window.setInterval(() => {
      if (adopt()) window.clearInterval(id)
    }, 100)
    return () => window.clearInterval(id)
  }, [loading, error, collapsed, patch])

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
    hunkSeparators: 'line-info',
    expandUnchanged: false,
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

  // Use the last measured rendered height when available so the placeholder
  // we leave behind after virtualising-out matches the real size; fall back
  // to the visibleLines estimate for first paint.
  const placeholderHeight = Math.max(stableHeight ?? 0, reservedHeight)
  const wrapperStyle: React.CSSProperties = collapsed ? {} : { minHeight: placeholderHeight }

  if (loading && !patch) {
    return (
      <div
        ref={containerRef}
        className="px-4 py-3 font-mono text-xs text-mute border-b border-hairline-soft"
        style={{ minHeight: reservedHeight }}
      >
        {path} — loading…
      </div>
    )
  }
  if (error) {
    return (
      <div
        ref={containerRef}
        className="px-4 py-3 font-mono text-xs text-crimson border-b border-hairline-soft"
      >
        {path} — {error.message}
      </div>
    )
  }
  if (!inRange && !collapsed) {
    return <div ref={containerRef} aria-hidden="true" style={wrapperStyle} />
  }

  return (
    <div ref={containerRef} style={wrapperStyle} className="relative">
      <div className="sticky top-0 z-20 flex items-center gap-2 px-3 py-2 bg-bg border-b border-hairline">
        <button
          type="button"
          aria-label={collapsed ? 'Expand file' : 'Collapse file'}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
          className="inline-flex items-center justify-center w-6 h-6 rounded-sm text-mute hover:text-ink hover:bg-bg-card cursor-pointer flex-shrink-0"
        >
          {collapsed ? (
            <ChevronRight size={16} aria-hidden="true" />
          ) : (
            <ChevronDown size={16} aria-hidden="true" />
          )}
        </button>
        <span className="font-mono text-sm text-ink truncate">{path}</span>
        <span className="font-mono text-xs whitespace-nowrap">
          <span className="text-crimson">-{deletions}</span>
          <span className="text-faint"> </span>
          <span className="text-moss">+{additions}</span>
        </span>
        {onToggleViewed && (
          <span className="ml-auto">
            <ViewedCheck isOn={viewed} onToggle={handleToggleViewed} />
          </span>
        )}
      </div>
      {!collapsed &&
        (fileDiff ? (
          <FileDiff
            fileDiff={fileDiff}
            options={options}
            lineAnnotations={annotations}
            selectedLines={selectedLines}
            renderCustomHeader={hideDefaultHeader}
            renderAnnotation={renderAnnotation}
          />
        ) : (
          <PatchDiff
            patch={patch}
            options={options}
            lineAnnotations={annotations}
            selectedLines={selectedLines}
            renderCustomHeader={hideDefaultHeader}
            renderAnnotation={renderAnnotation}
          />
        ))}
    </div>
  )
}

const hideDefaultHeader: NonNullable<RenderCustomHeader> = () => null
// Pierre/diffs renders each row at line-height 20px (font-size 13px / lh 20)
// regardless of our --hunkline-h token, and our sticky title bar measures
// ~40px. Slight under-estimation keeps the wrapper from over-reserving and
// leaving visible whitespace between files; tiny CLS during streaming is
// preferable to a permanent gap.
const LINE_HEIGHT = 20
const FILE_HEADER_HEIGHT = 40
// Keep file blocks within ~5 viewports of the scroll port mounted; anything
// further away collapses to a placeholder so pierre's diff DOM, shadow root,
// and shiki tokens are released. Wide enough that normal scrolling stays
// inside the warm zone, small enough that hundreds-of-files commits don't
// drag every diff into memory at once.
const VIRTUAL_MARGIN_PX = 5000

let diffsScrollbarSheetCache: CSSStyleSheet | null = null
function getDiffsScrollbarSheet(): CSSStyleSheet | null {
  if (typeof CSSStyleSheet === 'undefined') return null
  if (diffsScrollbarSheetCache) return diffsScrollbarSheetCache
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(`
    [data-code]{scrollbar-width:thin;scrollbar-color:var(--hairline) transparent;}
    [data-code]::-webkit-scrollbar{width:8px;height:8px;}
    [data-code]::-webkit-scrollbar-track{background:transparent;}
    [data-code]::-webkit-scrollbar-thumb{background-color:var(--hairline);border:none;border-radius:9999px;}
    [data-code]:hover::-webkit-scrollbar-thumb,
    :is([data-diff],[data-file]):hover [data-code]::-webkit-scrollbar-thumb{background-color:var(--faint);}
    [data-code]::-webkit-scrollbar-corner{background:transparent;}
  `)
  diffsScrollbarSheetCache = sheet
  return sheet
}

// data-expand-button labels are applied by installA11yPatches in __root.tsx.
