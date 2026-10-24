import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import {
  desktopTableClass,
  MobileList,
  MobileListLink,
  PageHeader,
  RowMeta,
  RowTitle,
} from '#/components/responsive'
import { Button } from '#/components/ui/button'
import { useCan } from '#/features/auth/use-can'
import { propertiesQuery } from '#/features/properties/functions'
import { useAddPropertyDrawer } from '#/features/properties/property-form'
import { cn } from '#/lib/utils'

export const Route = createFileRoute('/_app/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(propertiesQuery()),
  component: PropertiesPage,
})

function PropertiesPage() {
  const canManage = useCan()({ property: ['manage'] })
  const { data: properties } = useSuspenseQuery(propertiesQuery())
  const addProperty = useAddPropertyDrawer()

  return (
    <div className={cn('grid gap-6 sm:gap-8', canManage && 'pb-20 md:pb-0')}>
      <PageHeader
        title="Fastigheter"
        subtitle={properties.length > 0 && `${properties.length} fastigheter`}
        action={
          canManage && (
            <Button size="fab" onClick={addProperty.open}>
              <Plus aria-hidden="true" />
              Lägg till fastighet
            </Button>
          )
        }
      />
      {canManage && addProperty.drawer}
      {properties.length === 0 ? (
        <p className="text-muted-foreground">Inga fastigheter ännu.</p>
      ) : (
        <>
          <MobileList>
            {properties.map((p) => (
              <li key={p.id}>
                <MobileListLink to="/properties/$propertyId" params={{ propertyId: p.id }}>
                  <RowTitle>{p.designation}</RowTitle>
                  <RowMeta>
                    {[p.name, p.streetAddress, p.city].filter(Boolean).join(' · ') || '–'}
                  </RowMeta>
                </MobileListLink>
              </li>
            ))}
          </MobileList>
          <table className={desktopTableClass}>
            <thead className="border-b text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">Beteckning</th>
                <th className="py-2 font-medium">Namn</th>
                <th className="py-2 font-medium">Adress</th>
              </tr>
            </thead>
            <tbody>
              {properties.map((p) => (
                <tr key={p.id} className="border-b">
                  <td className="py-2">
                    <Link
                      to="/properties/$propertyId"
                      params={{ propertyId: p.id }}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {p.designation}
                    </Link>
                  </td>
                  <td className="py-2">{p.name}</td>
                  <td className="py-2">
                    {[p.streetAddress, [p.postalCode, p.city].filter(Boolean).join(' ')]
                      .filter(Boolean)
                      .join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
