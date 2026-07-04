import { processFile, type FileDiffMetadata } from '@pierre/diffs'
import { FileDiff, PatchDiff } from '@pierre/diffs/react'
import { useHotkeys } from '@tanstack/react-hotkeys'
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
} from 'react'
import { CommentComposer } from '#/components/comment-composer'
import { CommentThread } from '#/components/comment-thread'
import { computeWrapperMinHeight, useStableHeight } from '#/components/diff-view-height'
import { ViewedCheck } from '#/components/ui/viewed-check'
import type { Comment, Side } from '#/lib/comments'
import { buildDiffSearchHits, type DiffSearchHit } from '#/lib/diff-search'
import { useDiff, useFileBlobs } from '#/lib/diff-api'
import { observeHeight, observeInView } from '#/lib/observer-pool'

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
  status?: string
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
  treeJumpPath?: string
  treeJumpSeq?: number
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
  treeJumpPath,
  treeJumpSeq = 0,
}: DiffViewProps) {
  const patchMapRef = useRef(new Map<string, string>())
  const [patchVersion, setPatchVersion] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeHitIndex, setActiveHitIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const registerPatch = useCallback((path: string, patch: string | null) => {
    const prev = patchMapRef.current.get(path)
    if (patch == null) {
      if (patchMapRef.current.delete(path)) setPatchVersion((v) => v + 1)
      return
    }
    if (prev === patch) return
    patchMapRef.current.set(path, patch)
    setPatchVersion((v) => v + 1)
  }, [])
  const hits = useMemo(() => {
    void patchVersion
    return buildDiffSearchHits(files, patchMapRef.current, searchQuery)
  }, [files, patchVersion, searchQuery])
  const activeHit = hits[activeHitIndex]
  const openSearch = useCallback(() => {
    if (typeof document !== 'undefined') {
      restoreFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
    setSearchOpen(true)
    searchInputRef.current?.focus()
    searchInputRef.current?.select()
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
  }, [])
  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    window.requestAnimationFrame(() => restoreFocusRef.current?.focus())
  }, [])
  const moveHit = useCallback(
    (delta: number) => {
      if (hits.length === 0) return
      setActiveHitIndex((i) => (i + delta + hits.length) % hits.length)
    },
    [hits.length],
  )

  useEffect(() => {
    if (!searchOpen) return
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
  }, [searchOpen])

  useEffect(() => {
    setActiveHitIndex(0)
  }, [searchQuery])

  useEffect(() => {
    if (activeHitIndex >= hits.length) {
      setActiveHitIndex(Math.max(0, hits.length - 1))
    }
  }, [activeHitIndex, hits.length])

  useHotkeys([{ hotkey: 'Mod+F', callback: openSearch }], {
    preventDefault: true,
    ignoreInputs: false,
  })

  return (
    <div className={className}>
      {searchOpen && (
        <DiffSearchPanel
          query={searchQuery}
          onQueryChange={setSearchQuery}
          inputRef={searchInputRef}
          active={hits.length > 0 ? activeHitIndex + 1 : 0}
          total={hits.length}
          activeHit={activeHit}
          onNext={() => moveHit(1)}
          onPrev={() => moveHit(-1)}
          onClose={closeSearch}
        />
      )}
      {files.map((f) => (
        <FileBlock
          key={f.path}
          rev={rev}
          path={f.path}
          status={f.status}
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
          activeSearchHit={activeHit?.path === f.path ? activeHit : undefined}
          treeJumpSeq={treeJumpPath === f.path ? treeJumpSeq : 0}
          onPatchChange={registerPatch}
        />
      ))}
    </div>
  )
}

interface DiffSearchPanelProps {
  query: string
  onQueryChange: (value: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  active: number
  total: number
  activeHit?: DiffSearchHit
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}

function DiffSearchPanel({
  query,
  onQueryChange,
  inputRef,
  active,
  total,
  activeHit,
  onNext,
  onPrev,
  onClose,
}: DiffSearchPanelProps) {
  return (
    <div className="fixed top-[calc(var(--topbar-h)+8px)] right-4 z-50 w-[min(520px,calc(100vw-32px))] rounded-sm border border-hairline bg-bg-soft shadow-lg">
      <div className="flex items-center gap-2 p-2">
        <Search size={16} aria-hidden="true" className="text-mute flex-shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
              e.preventDefault()
              inputRef.current?.focus()
              inputRef.current?.select()
            } else if (e.key === 'Enter') {
              e.preventDefault()
              if (e.shiftKey) onPrev()
              else onNext()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
          placeholder="search diff"
          className="min-w-0 flex-1 h-8 px-2 rounded-sm border border-hairline bg-bg font-mono text-sm text-ink outline-none focus:border-rust"
        />
        <span className="font-mono text-xs text-mute whitespace-nowrap">
          {query.trim() ? `${active} / ${total}` : '0 / 0'}
        </span>
        <button
          type="button"
          onClick={onPrev}
          disabled={total === 0}
          className="h-8 px-2 rounded-sm border border-hairline bg-bg text-xs font-mono text-ink disabled:text-faint disabled:cursor-not-allowed hover:bg-bg-card"
        >
          prev
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={total === 0}
          className="h-8 px-2 rounded-sm border border-hairline bg-bg text-xs font-mono text-ink disabled:text-faint disabled:cursor-not-allowed hover:bg-bg-card"
        >
          next
        </button>
        <button
          type="button"
          aria-label="close search"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-mute hover:bg-bg-card hover:text-ink"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {activeHit && (
        <div className="border-t border-hairline-soft px-3 py-2 font-mono text-xs text-mute truncate">
          <span className="text-ink">{activeHit.path}</span>
          <span className="px-1">·</span>
          <span>{activeHit.kind === 'path' ? 'path' : `line ${activeHit.rowIndex + 1}`}</span>
        </div>
      )}
    </div>
  )
}

interface FileBlockProps {
  rev: string
  path: string
  status?: string
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
  activeSearchHit?: DiffSearchHit
  treeJumpSeq?: number
  onPatchChange?: (path: string, patch: string | null) => void
}

interface ComposingState {
  side: Side
  startLineNumber: number
  endLineNumber: number
}

function FileBlock({
  rev,
  path,
  status,
  repo,
  additions,
  deletions,
  visibleLines,
  visibleLinesSplit,
  refreshKey,
  initialPatch,
  layout,
  theme,
  comments = EMPTY_COMMENTS,
  viewed,
  onToggleViewed,
  onAddComment,
  onDeleteComment,
  ignoreWhitespace,
  activeSearchHit,
  treeJumpSeq,
  onPatchChange,
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
  const collapseTouchedRef = useRef(false)
  const [collapsed, setCollapsed] = useState(() => viewed || shouldAutoCollapseFile(path, status))
  const containerRef = useRef<HTMLDivElement>(null)
  // Virtual-scroll the diff list: only blocks within VIRTUAL_MARGIN of the
  // viewport stay mounted. Everything else collapses to a placeholder div of
  // the same reserved height, removing the diff DOM, pierre's shadow root,
  // and the shiki tokenisation cost. SSR mounts every block (no IO on
  // server) so the initial paint hydrates with content in place.
  const [inRange, setInRange] = useState(true)
  const isActiveSearchHit = activeSearchHit != null

  const handleToggleViewed = () => {
    setCollapsed(!viewed)
    onToggleViewed?.()
  }

  const toggleCollapsed = () => {
    collapseTouchedRef.current = true
    setCollapsed((c) => !c)
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    return observeInView(el, DIFF_VIEWPORT_MARGIN, setInRange)
  }, [])

  useEffect(() => {
    onPatchChange?.(path, patch || null)
    return () => onPatchChange?.(path, null)
  }, [onPatchChange, patch, path])

  useEffect(() => {
    if (!activeSearchHit) return
    collapseTouchedRef.current = true
    if (viewed) onToggleViewed?.()
    setCollapsed(false)
    setInRange(true)
  }, [activeSearchHit, onToggleViewed, viewed])

  useEffect(() => {
    if (!activeSearchHit) return
    const el = containerRef.current
    if (!el) return
    const jump = () => {
      scrollFileBlockIntoView(el, activeSearchHit.rowIndex)
    }
    const id = window.setTimeout(jump, inRange && !collapsed ? 30 : 80)
    return () => window.clearTimeout(id)
  }, [activeSearchHit, collapsed, inRange])

  useEffect(() => {
    if (!treeJumpSeq) return
    const el = containerRef.current
    if (!el) return
    setInRange(true)
    const id = window.setTimeout(() => scrollFileBlockIntoView(el, 0), inRange ? 30 : 80)
    return () => window.clearTimeout(id)
  }, [inRange, treeJumpSeq])

  useEffect(() => {
    if (!collapseTouchedRef.current && shouldAutoCollapseFile(path, status)) {
      setCollapsed(true)
    }
  }, [path, status])

  useEffect(() => {
    if (!collapseTouchedRef.current && !collapsed && patch.includes('@generated')) {
      setCollapsed(true)
    }
  }, [collapsed, patch])

  // Remember the rendered height so that the placeholder we leave behind when
  // the block scrolls out of the warm zone matches the real size. Tying the
  // observer subscription to `inRange` and `layout` makes the hook reset its
  // measurement when the active layout changes, otherwise a unified-mode
  // height would pin the wrapper open after switching to split.
  const observe = useCallback<(cb: (h: number) => void) => () => void>(
    (cb) => {
      if (!inRange) return () => {}
      const el = containerRef.current
      if (!el) return () => {}
      return observeHeight(el, cb)
    },
    [inRange],
  )
  const { stableHeight } = useStableHeight({ layout, observe })

  useEffect(() => {
    if (loading || error || collapsed) return
    const sheet = getDiffsScrollbarSheet()
    if (!sheet) return
    const wrapper = containerRef.current
    if (!wrapper) return
    const adopt = () => {
      const container = wrapper.querySelector('diffs-container')
      const root = container?.shadowRoot
      if (!root) return false
      if (root.adoptedStyleSheets.includes(sheet)) return true
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
      return true
    }
    if (adopt()) return
    // pierre's <PatchDiff> may attach its shadow root in a follow-up tick
    // after React commits. Replace the prior 100 ms polling loop with a
    // single MutationObserver that fires the moment the container appears
    // (or its shadow root mutates), then disconnects.
    const mo = new MutationObserver(() => {
      if (adopt()) mo.disconnect()
    })
    mo.observe(wrapper, { childList: true, subtree: true })
    return () => mo.disconnect()
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

  // While the block is in range the mounted content decides its own height,
  // so we only reserve `reservedHeight` to absorb CLS during streaming.
  // Once virtualised out we keep `max(stableHeight, reservedHeight)` so the
  // placeholder does not collapse. `computeWrapperMinHeight` is the single
  // source of truth and is covered by `diff-view-height.test.ts`.
  const minHeight = computeWrapperMinHeight({ collapsed, inRange, stableHeight, reservedHeight })
  const wrapperStyle: React.CSSProperties = minHeight != null ? { minHeight } : {}

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
      <div
        className={`sticky top-0 z-20 flex items-center gap-2 px-3 py-2 bg-bg border-b ${isActiveSearchHit ? 'border-amber bg-amber-soft' : 'border-hairline'}`}
      >
        <button
          type="button"
          aria-label={collapsed ? 'Expand file' : 'Collapse file'}
          aria-expanded={!collapsed}
          onClick={toggleCollapsed}
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
      {isActiveSearchHit && (
        <div className="px-3 py-1.5 border-b border-amber bg-amber-soft font-mono text-xs text-amber">
          {activeSearchHit.kind === 'path' ? 'path' : `line ${activeSearchHit.rowIndex + 1}`} ·{' '}
          <span className="text-ink">{activeSearchHit.preview}</span>
        </div>
      )}
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
const EMPTY_COMMENTS: Comment[] = []
const LOCK_FILE_NAMES = new Set([
  'bun.lock',
  'bun.lockb',
  'cargo.lock',
  'composer.lock',
  'flake.lock',
  'gemfile.lock',
  'go.sum',
  'mix.lock',
  'package-lock.json',
  'pipfile.lock',
  'pnpm-lock.yaml',
  'poetry.lock',
  'yarn.lock',
])

function shouldAutoCollapseFile(path: string, status?: string): boolean {
  if (status === 'deleted') return true
  const lower = path.toLowerCase()
  const name = lower.split('/').at(-1) ?? lower
  return (
    LOCK_FILE_NAMES.has(name) ||
    name.endsWith('.lock') ||
    lower.includes('/generated/') ||
    lower.includes('/__generated__/') ||
    lower.includes('.generated.')
  )
}

function scrollFileBlockIntoView(el: HTMLElement, rowIndex: number) {
  el.scrollIntoView({ block: 'start' })
  window.requestAnimationFrame(() => {
    const scroller = el.closest('main')
    if (scroller) {
      scroller.scrollTop += Math.max(0, rowIndex * LINE_HEIGHT - 120)
    }
  })
}
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
const DIFF_VIEWPORT_MARGIN: IntersectionObserverInit = { rootMargin: '5000px 0px' }

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
