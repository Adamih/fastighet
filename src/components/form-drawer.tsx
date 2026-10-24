import { X } from 'lucide-react'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react'
import { Button } from '#/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '#/components/ui/drawer'
import { useIsMobile } from '#/hooks/use-mobile'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'

export type FormDrawerSize = 'default' | 'wide'

interface FormDrawerContextValue {
  formId: string
  footer: HTMLDivElement | null
  busy: boolean
  setBusy: (busy: boolean) => void
  /** Called by the form's submit button whenever its state changes. */
  report: (state: { changed: boolean; submitting: boolean }) => void
}

const FormDrawerContext = createContext<FormDrawerContextValue | null>(null)

/** The surrounding `FormDrawer`, or null when the form is on a page. */
export const useFormDrawerContext = () => useContext(FormDrawerContext)

interface DrawerHostValue {
  update: (id: string, drawer: ReactNode, open: boolean) => void
  remove: (id: string) => void
}

const DrawerHostContext = createContext<DrawerHostValue | null>(null)

/** The app layout owns the drawer; feature hooks only open and update it. */
export function FormDrawerProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<{ id: string; drawer: ReactNode } | null>(null)
  const host = useMemo<DrawerHostValue>(
    () => ({
      update: (id, drawer, open) => {
        setActive((current) => (open || current?.id === id ? { id, drawer } : current))
      },
      remove: (id) => setActive((current) => (current?.id === id ? null : current)),
    }),
    [],
  )

  return (
    <DrawerHostContext.Provider value={host}>
      {children}
      {active?.drawer}
    </DrawerHostContext.Provider>
  )
}

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
  size = 'default',
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  /** Preferred desktop width; always leaves room outside the drawer for dismissal. */
  size?: FormDrawerSize
  children: ReactNode
}) {
  const mobile = useIsMobile()
  const formId = useId()
  const [footer, setFooter] = useState<HTMLDivElement | null>(null)
  const [changed, setChanged] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [actionPending, setActionPending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const busy = submitting || actionPending
  const guarded = changed || busy

  useEffect(() => {
    if (!open) {
      setChanged(false)
      setSubmitting(false)
      setActionPending(false)
      setConfirming(false)
    }
  }, [open])

  const context = useMemo<FormDrawerContextValue>(
    () => ({
      formId,
      footer,
      busy,
      setBusy: setActionPending,
      report: (state) => {
        setChanged(state.changed)
        setSubmitting(state.submitting)
        if (!state.changed) setConfirming(false)
      },
    }),
    [formId, footer, busy],
  )

  const requestClose = () => {
    if (busy) return
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
          'overflow-hidden',
          'data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-3rem)] data-[vaul-drawer-direction=bottom]:rounded-t-2xl',
          'data-[vaul-drawer-direction=right]:w-[calc(100dvw-3rem)]',
          size === 'wide'
            ? 'data-[vaul-drawer-direction=right]:sm:max-w-[37.5rem]'
            : 'data-[vaul-drawer-direction=right]:sm:max-w-md',
        )}
      >
        <div className="mt-2 flex shrink-0 items-center justify-between gap-3 border-b py-2 pr-2 pl-5">
          <DrawerTitle className="font-bold text-lg">{title}</DrawerTitle>
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label={m.common_close()}
            onClick={requestClose}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        {confirming && (
          <div
            role="alertdialog"
            aria-label={m.form_unsaved_label()}
            className="grid shrink-0 gap-2.5 border-b bg-amber-50 px-5 py-3 text-amber-900 text-sm dark:bg-amber-950 dark:text-amber-100"
          >
            <span>{m.form_unsaved_question()}</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="h-11 flex-1 sm:h-9"
                onClick={() => setConfirming(false)}
              >
                {m.form_keep_editing()}
              </Button>
              <Button variant="destructive" className="h-11 flex-1 sm:h-9" onClick={discard}>
                {m.form_discard()}
              </Button>
            </div>
          </div>
        )}
        <DrawerDescription className={description ? 'shrink-0 px-5 pt-4 text-[13px]' : 'sr-only'}>
          {description ?? title}
        </DrawerDescription>
        <FormDrawerContext.Provider value={context}>
          <div
            data-slot="form-drawer-body"
            className="@container/form-drawer min-h-0 flex-1 overflow-y-auto p-5"
          >
            {children}
          </div>
          <div
            ref={setFooter}
            data-slot="form-drawer-footer"
            className="shrink-0 border-t bg-background px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] empty:hidden"
          />
        </FormDrawerContext.Provider>
      </DrawerContent>
    </Drawer>
  )
}

/**
 * Owns a feature's drawer state and registers it with the app layout. Features define these
 * hooks next to their forms; pages only wire a button to `open`.
 */
export function useFormDrawer({
  title,
  description,
  size,
  form,
  onClose,
}: {
  title: string
  description?: string
  /** Use a wider desktop drawer for forms with more space requirements. */
  size?: FormDrawerSize
  /** The form; call `close` after a successful save. */
  form: (drawer: { close: () => void }) => ReactNode
  /** Runs whenever the drawer closes, e.g. to clear a mutation's error for next time. */
  onClose?: () => void
}) {
  const host = useContext(DrawerHostContext)
  if (!host) throw new Error('useFormDrawer requires FormDrawerProvider in the app layout')
  const id = useId()
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
  useEffect(() => {
    host.update(
      id,
      <FormDrawer
        key={id}
        open={isOpen}
        onOpenChange={setOpen}
        title={title}
        description={description}
        size={size}
      >
        {form({ close })}
      </FormDrawer>,
      isOpen,
    )
  }, [host, id, isOpen, setOpen, title, description, size, form, close])
  useEffect(() => () => host.remove(id), [host, id])

  return { open, close, isOpen }
}
