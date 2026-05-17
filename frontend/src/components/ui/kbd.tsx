import type { HTMLAttributes } from 'react'
import clsx from 'clsx'

export function Kbd({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={clsx(
        'inline-block rounded-sm border border-hairline border-b-2 bg-bg px-1.5 py-px font-mono text-xs leading-tight text-mute',
        className,
      )}
      {...rest}
    />
  )
}
