import { useEffect, useState, type PointerEvent } from 'react'
import clsx from 'clsx'

export interface ResizeHandleProps {
  width: number
  onWidthChange: (next: number) => void
  min?: number
  max?: number
  ariaLabel: string
}

export function ResizeHandle({
  width,
  onWidthChange,
  min = 200,
  max = 900,
  ariaLabel,
}: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!dragging) return
    const body = document.body
    const prevCursor = body.style.cursor
    const prevUserSelect = body.style.userSelect
    body.style.cursor = 'col-resize'
    body.style.userSelect = 'none'
    return () => {
      body.style.cursor = prevCursor
      body.style.userSelect = prevUserSelect
    }
  }, [dragging])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    setDragging(true)
    const onMove = (ev: globalThis.PointerEvent) => {
      const next = Math.max(min, Math.min(max, startW + (ev.clientX - startX)))
      onWidthChange(next)
    }
    const onUp = () => {
      setDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onWidthChange(Math.max(min, width - 16))
        else if (e.key === 'ArrowRight') onWidthChange(Math.min(max, width + 16))
      }}
      className={clsx(
        'w-1 cursor-col-resize select-none transition-colors',
        dragging ? 'bg-rust' : 'bg-hairline-soft hover:bg-rust',
      )}
    />
  )
}
