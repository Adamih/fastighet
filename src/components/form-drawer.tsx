import { X } from 'lucide-react'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { Button } from '#/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '#/components/ui/drawer'
import { useIsMobile } from '#/hooks/use-mobile'
import { cn } from '#/lib/utils'

interface FormDrawerContextValue {
  /** Called by the form's submit button whenever its state changes. */
  report: (state: { changed: boolean; submitting: boolean }) => void
}

const FormDrawerContext = createContext<FormDrawerContextValue | null>(null)

/** The surrounding `FormDrawer`, or null when the form is on a page. */
export const useFormDrawerContext = () => useContext(FormDrawerContext)

/**
 * A form in a drawer: from the bottom on phones, from the right on larger screens. For
 * occasional actions (terminate a lease, edit details) that shouldn't sit on the page itself.
 *
 * Forms built with `useAppForm` report back through their submit button: while there are
 * unsaved changes, closing asks first ("Släng ändringar?"), and while saving it stays open.
 * Closing from code (after a successful save) is never asked about.
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
  const [changed, setChanged] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const guarded = changed || submitting

  useEffect(() => {
    if (!open) {
      setChanged(false)
      setSubmitting(false)
      setConfirming(false)
    }
  }, [open])

  const context = useMemo<FormDrawerContextValue>(
    () => ({
      report: (state) => {
        setChanged(state.changed)
        setSubmitting(state.submitting)
        if (!state.changed) setConfirming(false)
      },
    }),
    [],
  )

  const requestClose = () => {
    if (submitting) return
    if (changed) setConfirming(true)
    else onOpenChange(false)
  }
  const discard = () => {
    setConfirming(false)
    onOpenChange(false)
  }
  /** Escape and clicks outside ask first when there is something to lose. */
  const guard = (event: Event) => {
    if (!guarded) return
    event.preventDefault()
    requestClose()
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}
      // With unsaved changes, swiping can't throw the form away; the close button asks instead.
      // (Turned back on while closing: vaul can't animate closed otherwise, e.g. after a save.)
      dismissible={!open || !guarded}
      direction={mobile ? 'bottom' : 'right'}
    >
      <DrawerContent
        onEscapeKeyDown={guard}
        onPointerDownOutside={guard}
        className={cn(
          'data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-3rem)] data-[vaul-drawer-direction=bottom]:rounded-t-2xl',
          'data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:sm:max-w-md',
        )}
      >
        <div className="mt-2 flex items-center justify-between gap-3 border-b py-2 pr-2 pl-5">
          <DrawerTitle className="font-bold text-lg">{title}</DrawerTitle>
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label="Stäng"
            onClick={requestClose}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        {confirming && (
          <div
            role="alertdialog"
            aria-label="Osparade ändringar"
            className="grid gap-2.5 border-b bg-amber-50 px-5 py-3 text-amber-900 text-sm dark:bg-amber-950 dark:text-amber-100"
          >
            <span>Du har osparade ändringar. Vill du slänga dem?</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="h-11 flex-1 sm:h-9"
                onClick={() => setConfirming(false)}
              >
                Fortsätt redigera
              </Button>
              <Button variant="destructive" className="h-11 flex-1 sm:h-9" onClick={discard}>
                Släng ändringar
              </Button>
            </div>
          </div>
        )}
        <DrawerDescription className={description ? 'px-5 pt-4 text-[13px]' : 'sr-only'}>
          {description ?? title}
        </DrawerDescription>
        <div className="overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <FormDrawerContext.Provider value={context}>{children}</FormDrawerContext.Provider>
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
