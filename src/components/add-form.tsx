import { Plus } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { FormDrawer } from '#/components/form-drawer'
import { Button } from '#/components/ui/button'

export interface AddFormSlot {
  /** Keeps field ids unique on the page. */
  idPrefix: string
  /** Drawers are narrow, so forms stack their fields. */
  layout: 'wide' | 'narrow'
  /** Call after a successful save; closes the drawer. */
  onSaved: () => void
}

/**
 * "Lägg till …" for a list page: a button that opens the form in a `FormDrawer`. Place it among
 * the page header's actions. From `md` up it is an ordinary button; on phones it floats at the
 * bottom right, so the page should leave room below its content (`pb-20 md:pb-0`).
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
  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 h-13 rounded-2xl px-5 text-[15px] shadow-lg md:static md:z-auto md:h-9 md:rounded-md md:px-4 md:text-sm md:shadow-none"
      >
        <Plus aria-hidden="true" />
        {title}
      </Button>
      <FormDrawer open={open} onOpenChange={setOpen} title={title} description={description}>
        {children({ idPrefix: 'add-', layout: 'narrow', onSaved: () => setOpen(false) })}
      </FormDrawer>
    </>
  )
}
