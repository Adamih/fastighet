import { Plus, X } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { Button } from '#/components/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from '#/components/ui/drawer'

export interface AddFormSlot {
  /** Keeps field ids unique: the form is on the page twice (card and drawer). */
  idPrefix: string
  /** `wide` pairs fields side by side in the card; `narrow` stacks them in the drawer. */
  layout: 'wide' | 'narrow'
  /** Call after a successful save; closes the drawer. */
  onSaved: () => void
}

/**
 * "Lägg till …" for a list page: a card under the list from `md` up, and on phones a floating
 * button that opens the same form in a drawer from the bottom.
 */
export function AddForm({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: (slot: AddFormSlot) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const headingId = useId()

  return (
    <>
      <section
        aria-labelledby={headingId}
        className="hidden gap-5 rounded-xl border bg-card p-5 md:grid md:max-w-xl lg:p-6"
      >
        <div className="grid gap-1">
          <h2 id={headingId} className="font-bold text-[17px]">
            {title}
          </h2>
          {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
        </div>
        {children({ idPrefix: 'card-', layout: 'wide', onSaved: () => {} })}
      </section>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>
          <Button className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 h-13 rounded-2xl px-5 text-[15px] shadow-lg md:hidden">
            <Plus aria-hidden="true" />
            {title}
          </Button>
        </DrawerTrigger>
        <DrawerContent className="data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-3rem)] data-[vaul-drawer-direction=bottom]:rounded-t-2xl md:hidden">
          <div className="mt-2 flex items-center justify-between gap-3 border-b py-2 pr-2 pl-5">
            <DrawerTitle className="font-bold text-lg">{title}</DrawerTitle>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon" className="size-11" aria-label="Stäng">
                <X aria-hidden="true" />
              </Button>
            </DrawerClose>
          </div>
          <DrawerDescription className="sr-only">{description ?? title}</DrawerDescription>
          <div className="overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {children({ idPrefix: 'drawer-', layout: 'narrow', onSaved: () => setOpen(false) })}
          </div>
        </DrawerContent>
      </Drawer>
      {/* Room for the floating button below the last row. */}
      <div aria-hidden="true" className="h-14 md:hidden" />
    </>
  )
}
