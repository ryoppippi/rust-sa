import type { ReactNode } from 'react'
import { HelpCircle } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Segmented, SegmentedItem } from '#/components/ui/segmented'

export type Mode = 'unified' | 'split'

export interface TopBarProps {
  base: string
  head: string
  separator?: '··' | '···'
  mode: Mode
  onModeChange: (mode: Mode) => void
  onHelp: () => void
  isLive?: boolean
  right?: ReactNode
}

function BrandMark() {
  return (
    <span className="inline-flex items-center gap-[2px]" aria-hidden="true">
      <i className="inline-block w-1 h-[14px] bg-rust" />
      <i className="inline-block w-1 h-[14px] bg-ink mt-1" />
      <i className="inline-block w-1 h-[14px] bg-rust opacity-50 -mt-1" />
    </span>
  )
}

export function TopBar({
  base,
  head,
  separator = '···',
  mode,
  onModeChange,
  onHelp,
  isLive,
  right,
}: TopBarProps) {
  return (
    <header className="flex items-center gap-4 px-4 h-[var(--topbar-h)] bg-bg font-mono text-[12.5px] text-ink-2">
      <div className="flex items-center gap-2 mr-1 flex-shrink-0 whitespace-nowrap text-ink text-[13px]">
        <BrandMark />
        <span className="font-medium">rust-sa</span>
      </div>

      <div className="flex items-center gap-2 pl-4 border-l border-hairline flex-shrink-0">
        <span className="text-ink">{base}</span>
        <span className="text-mute">{separator}</span>
        <span className="text-ink">{head}</span>
      </div>

      {isLive && (
        <span className="inline-flex items-center gap-1.5 px-2 py-[3px] border border-moss text-moss rounded-[3px] text-[11px] tracking-[0.02em] flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-moss" />
          live
        </span>
      )}

      <div className="ml-auto flex items-center gap-3">
        {right}
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
        <Button
          variant="ghost"
          size="md"
          onPress={onHelp}
          aria-label="Keybindings"
          className="w-7 px-0 justify-center"
        >
          <HelpCircle size={14} />
        </Button>
      </div>
    </header>
  )
}
