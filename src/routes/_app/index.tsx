import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  desktopTableClass,
  MobileList,
  MobileListLink,
  PageHeader,
  RowMeta,
  RowTitle,
} from '#/components/responsive'
import { useCan } from '#/features/auth/use-can'
import { createPropertyFn, propertiesQuery } from '#/features/properties/functions'
import { emptyProperty, PropertyForm } from '#/features/properties/property-form'

export const Route = createFileRoute('/_app/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(propertiesQuery()),
  component: PropertiesPage,
})

function PropertiesPage() {
  const canManage = useCan()({ property: ['manage'] })
  const { data: properties } = useSuspenseQuery(propertiesQuery())
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: createPropertyFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: propertiesQuery().queryKey }),
  })

  return (
    <div className="grid gap-6 sm:gap-8">
      <PageHeader
        title="Fastigheter"
        subtitle={properties.length > 0 && `${properties.length} fastigheter`}
      />
      {properties.length === 0 ? (
        <p className="text-muted-foreground">
          Inga fastigheter ännu.{canManage && ' Lägg till den första nedan.'}
        </p>
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
      {canManage && (
        <section className="grid max-w-xl gap-4 rounded-lg border p-4 sm:p-6">
          <h2 className="font-medium text-lg">Lägg till fastighet</h2>
          <PropertyForm
            defaultValues={emptyProperty}
            submitLabel="Spara"
            error={create.error}
            resetAfterSubmit
            onSubmit={(value) => create.mutateAsync({ data: value })}
          />
        </section>
      )}
    </div>
  )
}
