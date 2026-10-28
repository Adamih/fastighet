import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
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
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/_app/')({
  // A property manager has no properties of its own; it starts with its clients.
  beforeLoad: ({ context }) => {
    if (context.app.companyKind === 'manager') throw redirect({ to: '/clients' })
  },
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
        title={m.nav_properties()}
        subtitle={properties.length > 0 && m.property_count({ count: properties.length })}
        action={
          canManage && (
            <Button size="fab" onClick={addProperty.open}>
              <Plus aria-hidden="true" />
              {m.property_add()}
            </Button>
          )
        }
      />

      {properties.length === 0 ? (
        <p className="text-muted-foreground">{m.property_list_empty()}</p>
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
                <th className="py-2 font-medium">{m.property_designation()}</th>
                <th className="py-2 font-medium">{m.common_name()}</th>
                <th className="py-2 font-medium">{m.common_address()}</th>
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
