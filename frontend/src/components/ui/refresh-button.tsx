import { RefreshCw } from 'lucide-react'
import { Button } from '#/components/ui/button'
import clsx from 'clsx'

export function RefreshButton({
  isRefreshing,
  onRefresh,
  label = 'refresh',
}: {
  isRefreshing: boolean
  onRefresh: () => void
  label?: string
}) {
  return (
    <Button
      variant="secondary"
      size="md"
      onPress={onRefresh}
      isDisabled={isRefreshing}
      aria-label={label}
    >
      <RefreshCw size={16} aria-hidden="true" className={clsx(isRefreshing && 'animate-spin')} />
      {isRefreshing ? 'refreshing' : label}
    </Button>
  )
}
