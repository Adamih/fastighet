import { X } from 'lucide-react'
import { type ReactNode, useCallback, useState } from 'react'
import { Button } from '#/components/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '#/components/ui/drawer'
import { useIsMobile } from '#/hooks/use-mobile'
import { cn } from '#/lib/utils'

/**
 * A form in a drawer: from the bottom on phones, from the right on larger screens. For
 * occasional actions (terminate a lease, edit details) that shouldn't sit on the page itself.
 */
export function FormDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
}) {
  const mobile = useIsMobile()
  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction={mobile ? 'bottom' : 'right'}>
      <DrawerContent
        className={cn(
          'data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-3rem)] data-[vaul-drawer-direction=bottom]:rounded-t-2xl',
          'data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:sm:max-w-md',
        )}
      >
        <div className="mt-2 flex items-center justify-between gap-3 border-b py-2 pr-2 pl-5">
          <DrawerTitle className="font-bold text-lg">{title}</DrawerTitle>
          <DrawerClose asChild>
            <Button variant="ghost" size="icon" className="size-11" aria-label="Stäng">
              <X aria-hidden="true" />
            </Button>
          </DrawerClose>
        </div>
        <DrawerDescription className={description ? 'px-5 pt-4 text-[13px]' : 'sr-only'}>
          {description ?? title}
        </DrawerDescription>
        <div className="overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

/**
 * Owns a `FormDrawer`'s open state. Returns `open` for any button's `onClick` and the `drawer`
 * element, which the page renders once. Features define these hooks next to their forms (e.g.
 * `useAddTenantDrawer` in `tenant-form.tsx`), so pages only place a button and the drawer.
 */
export function useFormDrawer({
  title,
  description,
  form,
  onClose,
}: {
  title: string
  description?: string
  /** The form; call `close` after a successful save. */
  form: (drawer: { close: () => void }) => ReactNode
  /** Runs whenever the drawer closes, e.g. to clear a mutation's error for next time. */
  onClose?: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const setOpen = useCallback(
    (next: boolean) => {
      setIsOpen(next)
      if (!next) onClose?.()
    },
    [onClose],
  )
  const open = useCallback(() => setOpen(true), [setOpen])
  const close = useCallback(() => setOpen(false), [setOpen])
  const drawer = (
    <FormDrawer open={isOpen} onOpenChange={setOpen} title={title} description={description}>
      {form({ close })}
    </FormDrawer>
  )
  return { open, close, isOpen, drawer }
}
