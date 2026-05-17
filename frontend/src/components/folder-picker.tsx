import { gql } from '@apollo/client'
import { useQuery } from '@apollo/client/react'
import { ArrowUp, Check, File, Folder, GitBranch, Home, Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Dialog, Modal, ModalOverlay, type ModalOverlayProps } from 'react-aria-components'
import { Button } from '#/components/ui/button'
import { fuzzyScore } from '#/lib/fuzzy'
import clsx from 'clsx'

interface DirEntry {
  name: string
  isDir: boolean
  isGitRepo: boolean
  isHidden: boolean
}

interface DirListing {
  path: string
  parent: string | null
  entries: DirEntry[]
}

const LIST_DIR_QUERY = gql`
  query ListDir($path: String) {
    listDir(path: $path) {
      path
      parent
      entries {
        name
        isDir
        isGitRepo
        isHidden
      }
    }
  }
`

export interface FolderPickerProps extends Omit<ModalOverlayProps, 'children'> {
  onPick: (path: string) => void
  initialPath?: string | null
}

export function FolderPicker({ onPick, initialPath, ...rest }: FolderPickerProps) {
  const [cwd, setCwd] = useState<string | null>(initialPath ?? null)
  const [showHidden, setShowHidden] = useState(false)
  const [query, setQuery] = useState('')
  const { data, loading, error } = useQuery<{ listDir: DirListing }>(LIST_DIR_QUERY, {
    variables: { path: cwd },
    fetchPolicy: 'network-only',
  })
  const listing = data?.listDir
  const baseEntries = (listing?.entries ?? []).filter((e) => showHidden || !e.isHidden)
  const entries = query
    ? baseEntries
        .map((e) => ({ entry: e, score: fuzzyScore(query, e.name) }))
        .filter((x) => x.score > 0)
        .toSorted((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
        .map((x) => x.entry)
    : baseEntries

  useEffect(() => {
    setQuery('')
  }, [cwd])

  const close = () => rest.onOpenChange?.(false)

  const enter = (name: string) => {
    if (!listing) return
    const next = listing.path === '/' ? `/${name}` : `${listing.path}/${name}`
    setCwd(next)
  }

  return (
    <ModalOverlay
      {...rest}
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay"
    >
      <Modal className="w-full max-w-2xl h-140 max-h-[80vh] flex flex-col rounded-sm border border-hairline bg-bg">
        <Dialog className="outline-none flex flex-col min-h-0 h-full">
          <div className="flex items-center gap-3 border-b border-hairline px-5 pt-4 pb-3">
            <h2 className="m-0 font-serif text-xl font-normal tracking-tight">pick a repository</h2>
            <span className="ml-auto font-mono text-xs uppercase tracking-widest text-mute">
              <label className="cursor-pointer inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={showHidden}
                  onChange={(e) => setShowHidden(e.target.checked)}
                />
                show hidden
              </label>
            </span>
          </div>
          <Breadcrumb path={listing?.path ?? cwd ?? ''} onNavigate={setCwd} />
          <div className="px-5 py-2 border-b border-hairline-soft flex items-center gap-2 font-mono text-xs text-mute">
            <Search size={16} aria-hidden="true" className="text-faint flex-shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (entries.length > 0 && entries[0].isDir) {
                    e.preventDefault()
                    enter(entries[0].name)
                  }
                }
              }}
              placeholder="type to filter…"
              autoFocus
              className="flex-1 bg-transparent text-ink outline-none placeholder:text-faint"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="clear filter"
                className="text-faint hover:text-ink cursor-pointer inline-flex items-center"
              >
                <X size={16} aria-hidden="true" />
              </button>
            )}
            <span className="text-faint">
              {entries.length}
              {query ? ` / ${baseEntries.length}` : ''}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading && <div className="px-5 py-4 font-mono text-xs text-mute">loading…</div>}
            {error && (
              <div className="px-5 py-4 font-mono text-xs text-crimson">{error.message}</div>
            )}
            {listing?.parent && !query && (
              <EntryRow
                name=".."
                isDir
                icon={<ArrowUp size={16} aria-hidden="true" />}
                onActivate={() => setCwd(listing.parent)}
              />
            )}
            {entries.map((e) => (
              <EntryRow
                key={e.name}
                name={e.name}
                isDir={e.isDir}
                isGitRepo={e.isGitRepo}
                isHidden={e.isHidden}
                onActivate={() => e.isDir && enter(e.name)}
              />
            ))}
            {!loading && !error && entries.length === 0 && (
              <div className="px-5 py-4 font-mono text-xs text-mute">no matches</div>
            )}
          </div>
          <div className="border-t border-hairline px-5 py-3 flex items-center gap-2">
            <span className="font-mono text-xs text-mute truncate flex-1">
              {listing?.path ?? '—'}
            </span>
            <Button variant="ghost" size="sm" onPress={close}>
              <X size={16} aria-hidden="true" />
              cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onPress={() => {
                if (listing?.path) {
                  onPick(listing.path)
                  close()
                }
              }}
              isDisabled={!listing?.path}
            >
              <Check size={16} aria-hidden="true" />
              select this folder
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}

function Breadcrumb({ path, onNavigate }: { path: string; onNavigate: (p: string) => void }) {
  const segments = path.split('/').filter(Boolean)
  return (
    <div className="px-5 py-2 border-b border-hairline-soft font-mono text-xs flex flex-wrap items-center gap-1">
      <button
        type="button"
        className="inline-flex items-center text-rust hover:underline cursor-pointer"
        onClick={() => onNavigate('/')}
        aria-label="Root"
      >
        <Home size={16} aria-hidden="true" />
      </button>
      {segments.map((seg, i) => {
        const full = '/' + segments.slice(0, i + 1).join('/')
        return (
          <span key={full} className="inline-flex items-center gap-1">
            <span className="text-faint">/</span>
            <button
              type="button"
              className="text-rust hover:underline cursor-pointer"
              onClick={() => onNavigate(full)}
            >
              {seg}
            </button>
          </span>
        )
      })}
    </div>
  )
}

function EntryRow({
  name,
  isDir,
  isGitRepo,
  isHidden,
  icon,
  onActivate,
}: {
  name: string
  isDir: boolean
  isGitRepo?: boolean
  isHidden?: boolean
  icon?: React.ReactNode
  onActivate: () => void
}) {
  const fallbackIcon = isDir ? (
    <Folder size={16} aria-hidden="true" className={isGitRepo ? 'text-rust' : ''} />
  ) : (
    <File size={16} aria-hidden="true" />
  )
  return (
    <button
      type="button"
      onClick={onActivate}
      onDoubleClick={onActivate}
      disabled={!isDir}
      className={clsx(
        'w-full text-left px-5 py-1.5 font-mono text-xs flex items-center gap-2 border-b border-hairline-soft',
        isDir ? 'cursor-pointer hover:bg-bg-card' : 'cursor-default text-mute',
        isHidden && 'opacity-60',
      )}
    >
      <span className="text-faint w-3 inline-flex justify-center">{icon ?? fallbackIcon}</span>
      <span className={clsx(isGitRepo && 'text-rust')}>{name}</span>
      {isGitRepo && (
        <span className="ml-auto inline-flex items-center gap-1 font-mono text-xs uppercase tracking-widest text-rust">
          <GitBranch size={16} aria-hidden="true" />
          git
        </span>
      )}
    </button>
  )
}
