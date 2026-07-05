import { ChevronDown, GitBranch } from 'lucide-react'
import {
  Button,
  ComboBox,
  Header,
  Input,
  ListBox,
  ListBoxItem,
  ListBoxSection,
  Popover,
} from 'react-aria-components'
import type { RefObject } from 'react'
import clsx from 'clsx'

export interface RepoOption {
  path: string
  source: 'recent' | 'discovered'
  spec?: string | null
}

export function RepoComboBox({
  value,
  onChange,
  recentOptions,
  discoveredOptions,
  inputRef,
  error,
}: {
  value: string
  onChange: (value: string) => void
  recentOptions: RepoOption[]
  discoveredOptions: RepoOption[]
  inputRef?: RefObject<HTMLInputElement | null>
  error?: string | null
}) {
  const query = value.trim().toLowerCase()
  const recent = filterOptions(recentOptions, query).slice(0, 8)
  const discovered = filterOptions(discoveredOptions, query)
    .filter((candidate) => !recentOptions.some((entry) => entry.path === candidate.path))
    .slice(0, 24)
  const all = [...recent, ...discovered]
  const selectedKey = all.find((option) => option.path === value)?.path ?? null
  return (
    <ComboBox
      inputValue={value}
      onInputChange={onChange}
      selectedKey={selectedKey}
      onSelectionChange={(key) => {
        if (key) onChange(String(key))
      }}
      allowsCustomValue
      allowsEmptyCollection
      menuTrigger="input"
      aria-label="repository"
      className="relative flex-1 min-w-0"
    >
      <div
        className={clsx(
          'flex h-9 rounded-sm border bg-bg focus-within:border-rust',
          error ? 'border-crimson' : 'border-hairline',
        )}
      >
        <Input
          ref={inputRef}
          placeholder="type or pick a git repository…"
          className="min-w-0 flex-1 px-3 bg-transparent font-mono text-xs text-ink outline-none placeholder:text-faint"
        />
        <Button
          type="button"
          className="inline-flex w-9 items-center justify-center border-l border-hairline text-mute hover:text-ink hover:bg-bg-card cursor-pointer"
        >
          <ChevronDown size={16} aria-hidden="true" />
        </Button>
      </div>
      <Popover className="w-(--trigger-width) rounded-sm border border-hairline bg-bg shadow-lg overflow-hidden">
        <ListBox
          className="max-h-96 overflow-y-auto py-1 outline-none"
          renderEmptyState={() => (
            <div className="px-3 py-2 font-mono text-xs text-mute">
              No matching repository. Press Enter to validate this path.
            </div>
          )}
        >
          {recent.length > 0 && (
            <ListBoxSection>
              <Header className="px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-mute">
                recent
              </Header>
              {recent.map((option) => (
                <RepoOptionItem key={`recent:${option.path}`} option={option} />
              ))}
            </ListBoxSection>
          )}
          {discovered.length > 0 && (
            <ListBoxSection>
              <Header className="px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-mute">
                discovered
              </Header>
              {discovered.map((option) => (
                <RepoOptionItem key={`discovered:${option.path}`} option={option} />
              ))}
            </ListBoxSection>
          )}
        </ListBox>
      </Popover>
    </ComboBox>
  )
}

function RepoOptionItem({ option }: { option: RepoOption }) {
  return (
    <ListBoxItem
      id={option.path}
      textValue={option.path}
      className="px-3 py-2 outline-none cursor-pointer data-[focused]:bg-bg-card data-[selected]:bg-rust-soft"
    >
      <div className="flex items-start gap-2 min-w-0 font-mono text-xs">
        <GitBranch size={14} aria-hidden="true" className="mt-0.5 text-rust flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-ink">{option.path}</div>
          <div className="text-faint">{option.spec ?? option.source}</div>
        </div>
      </div>
    </ListBoxItem>
  )
}

function filterOptions(options: RepoOption[], query: string): RepoOption[] {
  if (!query) return options
  return options.filter((option) => option.path.toLowerCase().includes(query))
}
