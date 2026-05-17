import { Link } from '@tanstack/react-router'
import { Check, ClipboardCopy, Radio, Trash2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { Dialog, Modal, ModalOverlay } from 'react-aria-components'
import { Button } from '#/components/ui/button'
import { Segmented, SegmentedItem } from '#/components/ui/segmented'

export type Mode = 'unified' | 'split'
export type Theme = 'light' | 'dark'
export type View = 'diff' | 'graph'

export interface TopBarProps {
  base: string
  head?: string
  separator?: '··' | '···'
  mode: Mode
  onModeChange: (mode: Mode) => void
  theme: Theme
  onThemeChange: (theme: Theme) => void
  view: View
  onViewChange: (view: View) => void
  viewedCount: number
  totalCount: number
  onCopyPrompts?: () => void
  copyPromptsLabel?: string
  onClearPrompts?: () => void
  clearPromptsLabel?: string
  isLive?: boolean
  right?: ReactNode
}

function ViewedProgress({ count, total }: { count: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((count / total) * 100)
  return (
    <div
      className="flex items-center gap-2 font-mono text-xs text-mute"
      title={`${count} / ${total} files viewed`}
    >
      <span className="text-ink">
        {count}/{total}
      </span>
      <div className="relative w-25 h-1 bg-bg-card rounded-full overflow-hidden">
        <i
          className="absolute top-0 left-0 bottom-0 bg-moss transition-all duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span>{pct}%</span>
    </div>
  )
}

function ViewTabs({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  const tabs: View[] = ['diff', 'graph']
  return (
    <div className="inline-flex pl-3 ml-2 border-l border-hairline">
      {tabs.map((tab) => {
        const active = tab === value
        return (
          <button
            key={tab}
            type="button"
            onClick={() => onChange(tab)}
            className={
              'relative border-0 bg-transparent font-mono text-xs py-2 px-3 cursor-pointer tracking-wide ' +
              (active ? 'text-ink' : 'text-mute')
            }
          >
            {tab}
            {active && <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-rust" />}
          </button>
        )
      })}
    </div>
  )
}

function CopyPromptsButton({ onPress, label }: { onPress: () => void; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="secondary"
      size="md"
      onPress={() => {
        onPress()
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      }}
    >
      <span className="relative inline-flex items-center justify-center whitespace-nowrap">
        <span
          aria-hidden="true"
          className="invisible inline-flex items-center gap-1.5 whitespace-nowrap"
        >
          <ClipboardCopy size={16} />
          {label}
        </span>
        <span className="absolute inset-0 inline-flex items-center justify-center whitespace-nowrap">
          <AnimatePresence mode="wait" initial={false}>
            {copied ? (
              <motion.span
                key="copied"
                className="inline-flex items-center gap-1.5 text-moss"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              >
                <Check size={16} aria-hidden="true" />
                copied!
              </motion.span>
            ) : (
              <motion.span
                key="copy"
                className="inline-flex items-center gap-1.5"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
              >
                <ClipboardCopy size={16} aria-hidden="true" />
                {label}
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </span>
    </Button>
  )
}

function ClearPromptsButton({ onPress, label }: { onPress: () => void; label: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="secondary" size="md" onPress={() => setOpen(true)}>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <Trash2 size={16} aria-hidden="true" />
          {label}
        </span>
      </Button>
      <ModalOverlay
        isOpen={open}
        onOpenChange={setOpen}
        isDismissable
        className="fixed inset-0 z-50 flex items-center justify-center bg-overlay"
      >
        <Modal className="w-full max-w-sm rounded-sm border border-hairline bg-bg">
          <Dialog role="alertdialog" className="outline-none">
            {({ close }) => (
              <div className="flex flex-col gap-4 p-5">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-sm bg-crimson-soft text-crimson flex-shrink-0">
                    <Trash2 size={16} aria-hidden="true" />
                  </span>
                  <div className="flex flex-col gap-1">
                    <h2 className="m-0 font-serif text-xl font-normal tracking-tight">
                      Clear all prompts?
                    </h2>
                    <p className="m-0 font-sans text-sm text-ink-2">
                      Drafts on this revision will be removed. This cannot be undone.
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={close}
                    className="ml-auto inline-flex items-center justify-center w-7 h-7 rounded-sm text-mute hover:text-ink hover:bg-bg-card cursor-pointer flex-shrink-0"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button variant="ghost" size="sm" onPress={close}>
                    cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    className="bg-crimson border-crimson hover:bg-crimson hover:border-crimson"
                    onPress={() => {
                      onPress()
                      close()
                    }}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                    clear
                  </Button>
                </div>
              </div>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </>
  )
}

function BrandMark() {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      <i className="inline-block w-1 h-3.5 bg-rust" />
      <i className="inline-block w-1 h-3.5 bg-ink mt-1" />
      <i className="inline-block w-1 h-3.5 bg-rust opacity-50 -mt-1" />
    </span>
  )
}

export function TopBar({
  base,
  head,
  separator = '···',
  mode,
  onModeChange,
  theme,
  onThemeChange,
  view,
  onViewChange,
  viewedCount,
  totalCount,
  onCopyPrompts,
  copyPromptsLabel = 'copy prompts',
  onClearPrompts,
  clearPromptsLabel = 'clear prompts',
  isLive,
  right,
}: TopBarProps) {
  return (
    <header className="flex items-center gap-4 px-4 h-[var(--topbar-h)] bg-bg font-mono text-xs text-ink-2">
      <Link
        to="/"
        aria-label="rust-sa home"
        className="flex items-center gap-2 mr-1 flex-shrink-0 whitespace-nowrap text-ink text-sm hover:text-rust rounded-sm"
      >
        <BrandMark />
        <span className="font-medium">rust-sa</span>
      </Link>

      <div className="flex items-center gap-2 pl-4 border-l border-hairline flex-shrink-0">
        <span className="text-ink">{base}</span>
        {head != null && (
          <>
            <span className="text-mute">{separator}</span>
            <span className="text-ink">{head}</span>
          </>
        )}
      </div>

      {isLive && (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-moss-deep text-bg rounded-sm text-xs tracking-wide flex-shrink-0 font-medium">
          <Radio size={16} aria-hidden="true" />
          live
        </span>
      )}

      <ViewedProgress count={viewedCount} total={totalCount} />

      <div className="ml-auto flex items-center gap-3">
        {right}
        <ViewTabs value={view} onChange={onViewChange} />
        <Segmented
          aria-label="View mode"
          selectedKeys={[mode]}
          onSelectionChange={(keys) => {
            const first = [...keys][0]
            if (first === 'unified' || first === 'split') onModeChange(first)
          }}
        >
          <SegmentedItem id="unified">unified</SegmentedItem>
          <SegmentedItem id="split">split</SegmentedItem>
        </Segmented>
        <Segmented
          aria-label="Theme"
          selectedKeys={[theme]}
          onSelectionChange={(keys) => {
            const first = [...keys][0]
            if (first === 'light' || first === 'dark') onThemeChange(first)
          }}
        >
          <SegmentedItem id="light">light</SegmentedItem>
          <SegmentedItem id="dark">dark</SegmentedItem>
        </Segmented>
        {onCopyPrompts && <CopyPromptsButton onPress={onCopyPrompts} label={copyPromptsLabel} />}
        {onClearPrompts && (
          <ClearPromptsButton onPress={onClearPrompts} label={clearPromptsLabel} />
        )}
      </div>
    </header>
  )
}
