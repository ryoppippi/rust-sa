import type { HTMLAttributes } from 'react'
import clsx from 'clsx'

const tones = {
  rust: 'bg-rust text-cream',
  amber: 'bg-amber text-ink',
  moss: 'bg-moss-strong text-moss',
  neutral: 'bg-bg-card text-ink border border-hairline',
} as const

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: keyof typeof tones
}

export function Tag({ tone = 'neutral', className, ...rest }: TagProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-1 font-mono text-xs leading-none',
        tones[tone],
        className,
      )}
      {...rest}
    />
  )
}
