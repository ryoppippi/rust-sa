import { ChevronDown, ChevronRight, type GitBranch, Search, X } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Button as AriaButton, Input as AriaInput, SearchField } from 'react-aria-components'
import clsx from 'clsx'
import { fuzzyScore } from '#/lib/fuzzy'
import { usePreference } from '#/lib/preference'

export interface GitRef {
  name: string
  shortSha: string
  isCurrent: boolean
}

export function RefSection({
  title,
  icon: Icon,
  refs,
  base,
  head,
  rowHeight,
  storageKey,
  onClick,
  onDoubleClick,
}: {
  title: string
  icon: typeof GitBranch
  refs: GitRef[]
  base: string | null
  head: string | null
  rowHeight: number
  storageKey: string
  onClick: (e: MouseEvent, name: string) => void
  onDoubleClick: (name: string) => void
}) {
  const [openStr, setOpenStr] = usePreference<string>(storageKey, 'false')
  const open = openStr === 'true'
  const [query, setQuery] = useState('')
  const [pendingFocus, setPendingFocus] = useState(false)
  const filterInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open && pendingFocus) {
      filterInputRef.current?.focus()
      setPendingFocus(false)
    }
  }, [open, pendingFocus])

  if (refs.length === 0) return null

  const filtered = query
    ? refs
        .map((r) => ({ ref: r, score: fuzzyScore(query, r.name) }))
        .filter((x) => x.score > 0)
        .toSorted((a, b) => b.score - a.score || a.ref.name.localeCompare(b.ref.name))
        .map((x) => x.ref)
    : refs

  const handleToggle = () => {
    const next = !open
    setOpenStr(next ? 'true' : 'false')
    if (next) setPendingFocus(true)
  }

  return (
    <div className="border-b border-hairline-soft">
      <button
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center gap-1.5 px-3 py-2 font-mono text-xs uppercase tracking-widest text-mute hover:text-ink hover:bg-bg-card cursor-pointer"
      >
        {open ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
        <Icon size={14} aria-hidden="true" />
        {title}
        <span className="ml-auto normal-case tracking-normal text-mute">{refs.length}</span>
      </button>
      {open && (
        <>
          {refs.length > 5 && (
            <SearchField
              value={query}
              onChange={setQuery}
              aria-label={`Filter ${title}`}
              className="group flex items-center gap-1.5 px-3 py-1.5 border-b border-hairline-soft font-mono text-xs text-mute"
            >
              <Search size={14} aria-hidden="true" className="text-faint flex-shrink-0" />
              <AriaInput
                ref={filterInputRef}
                placeholder={`filter ${title}…`}
                className="flex-1 bg-transparent text-ink outline-none placeholder:text-faint min-w-0"
              />
              <AriaButton
                slot="clear"
                aria-label="clear filter"
                className="group-data-[empty]:hidden text-faint hover:text-ink cursor-pointer inline-flex items-center"
              >
                <X size={14} aria-hidden="true" />
              </AriaButton>
              <span className="text-faint group-data-[empty]:hidden">{filtered.length}</span>
            </SearchField>
          )}
          {filtered.length === 0 && (
            <div className="px-3 py-2 font-mono text-xs text-mute">no matches</div>
          )}
          {filtered.map((r) => {
            const isBase = base === r.name
            const isHead = head === r.name
            return (
              <button
                key={r.name}
                type="button"
                data-spec={r.name}
                onClick={(e) => onClick(e, r.name)}
                onDoubleClick={() => onDoubleClick(r.name)}
                style={{ height: rowHeight }}
                className={clsx(
                  'w-full text-left flex items-center gap-2 px-3 font-mono text-xs cursor-pointer border-l-2',
                  isBase
                    ? 'bg-rust-soft border-l-rust'
                    : isHead
                      ? 'bg-moss-soft border-l-moss'
                      : 'border-l-transparent hover:bg-bg-card',
                )}
              >
                <span className="text-ink truncate flex-1">{r.name}</span>
                {r.isCurrent && (
                  <span className="text-amber uppercase tracking-wider text-[10px]">HEAD</span>
                )}
                <span className="text-rust">{r.shortSha}</span>
                {isBase && <span className="text-rust uppercase tracking-wider">base</span>}
                {isHead && <span className="text-moss uppercase tracking-wider">head</span>}
              </button>
            )
          })}
        </>
      )}
    </div>
  )
}
