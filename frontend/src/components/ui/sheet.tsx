import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
  type ModalOverlayProps,
} from 'react-aria-components'
import clsx from 'clsx'

export interface SheetProps extends Omit<ModalOverlayProps, 'children'> {
  title?: ReactNode
  hint?: ReactNode
  children: ReactNode
}

export function Sheet({ title, hint, children, className, ...rest }: SheetProps) {
  return (
    <ModalOverlay
      isDismissable
      className={clsx(
        'fixed inset-0 z-50 flex items-center justify-center bg-overlay',
        typeof className === 'string' ? className : undefined,
      )}
      {...rest}
    >
      <Modal className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-sm border border-hairline bg-bg">
        <Dialog className="outline-none flex flex-col min-h-0">
          {({ close }) => (
            <>
              <div className="flex items-baseline gap-3 border-b border-hairline px-5 pt-4 pb-3">
                {title && (
                  <Heading
                    slot="title"
                    className="m-0 font-serif text-2xl font-normal tracking-tight"
                  >
                    {title}
                  </Heading>
                )}
                {hint && <p className="m-0 font-mono text-xs text-mute">{hint}</p>}
                <button
                  type="button"
                  aria-label="Close"
                  onClick={close}
                  className="ml-auto inline-flex items-center justify-center w-7 h-7 rounded-sm text-mute hover:text-ink hover:bg-bg-card cursor-pointer"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
              <div className="overflow-y-auto px-5 pt-4 pb-5">{children}</div>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
