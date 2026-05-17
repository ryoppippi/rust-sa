import { Check, Circle } from 'lucide-react'
import clsx from 'clsx'

export interface ViewedCheckProps {
  isOn: boolean
  onToggle: () => void
}

export function ViewedCheck({ isOn, onToggle }: ViewedCheckProps) {
  const Icon = isOn ? Check : Circle
  return (
    <button
      type="button"
      onClick={onToggle}
      className={clsx(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded-sm border font-mono text-xs cursor-pointer transition-colors',
        isOn
          ? 'bg-moss-soft border-moss text-moss'
          : 'bg-bg border-hairline text-mute hover:bg-bg-card',
      )}
    >
      <Icon size={16} aria-hidden="true" />
      <span>viewed</span>
    </button>
  )
}
