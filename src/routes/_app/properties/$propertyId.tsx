import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { FieldError, TextField } from '#/components/text-field'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { LeaseStatusBadge } from '#/features/leases/components'
import { createUnitFn, propertyQuery } from '#/features/properties/functions'
import { type UnitKind, unitKindLabels, unitKinds } from '#/features/properties/unit-kinds'

export const Route = createFileRoute('/_app/properties/$propertyId')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(propertyQuery(params.propertyId)),
  component: PropertyPage,
})

const areaFormat = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 1 })

function PropertyPage() {
  const { propertyId } = Route.useParams()
  const { data: property } = useSuspenseQuery(propertyQuery(propertyId))

  return (
    <div className="grid gap-8">
      <div className="grid gap-1">
        <Link to="/" className="text-muted-foreground text-sm hover:underline">
          ← Fastigheter
        </Link>
        <h1 className="font-semibold text-2xl">{property.designation}</h1>
        {property.name && <p className="text-muted-foreground">{property.name}</p>}
      </div>

      <section className="grid gap-3">
        <h2 className="font-medium text-lg">Objekt</h2>
        {property.units.length === 0 ? (
          <p className="text-muted-foreground">Inga objekt ännu.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">Objekt</th>
                <th className="py-2 font-medium">Typ</th>
                <th className="py-2 text-right font-medium">Yta</th>
                <th className="py-2 pl-6 font-medium">Hyresgäst</th>
              </tr>
            </thead>
            <tbody>
              {property.units.map((u) => (
                <tr key={u.id} className="border-b">
                  <td className="py-2 font-medium">{u.label}</td>
                  <td className="py-2">{unitKindLabels[u.kind]}</td>
                  <td className="py-2 text-right">
                    {u.areaSqm == null ? '–' : `${areaFormat.format(u.areaSqm)} m²`}
                  </td>
                  <td className="py-2 pl-6">
                    {u.occupancy ? (
                      <span className="flex items-center gap-2">
                        <Link
                          to="/leases/$leaseId"
                          params={{ leaseId: u.occupancy.leaseId }}
                          className="underline-offset-4 hover:underline"
                        >
                          {u.occupancy.tenantName}
                        </Link>
                        <LeaseStatusBadge status={u.occupancy.status} />
                        <span className="text-muted-foreground tabular-nums">
                          {u.occupancy.status === 'upcoming'
                            ? `från ${u.occupancy.startDate}`
                            : u.occupancy.moveOutDate && `till ${u.occupancy.moveOutDate}`}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Vakant</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <CreateUnitForm propertyId={propertyId} />
    </div>
  )
}

function CreateUnitForm({ propertyId }: { propertyId: string }) {
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: createUnitFn,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: propertyQuery(propertyId).queryKey }),
  })

  const form = useForm({
    defaultValues: { kind: 'apartment' as UnitKind, label: '', area: '' },
    onSubmit: async ({ value, formApi }) => {
      const area = value.area.trim() ? Number(value.area.replace(',', '.')) : null
      await create.mutateAsync({
        data: { propertyId, kind: value.kind, label: value.label, areaSqm: area },
      })
      formApi.reset()
    },
  })

  return (
    <section className="grid max-w-xl gap-4 rounded-lg border p-6">
      <h2 className="font-medium text-lg">Lägg till objekt</h2>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
      >
        <div className="grid grid-cols-2 gap-4">
          <form.Field
            name="label"
            validators={{
              onSubmit: ({ value }) => (value.trim() ? undefined : 'Ange objektsnummer'),
            }}
          >
            {(field) => <TextField field={field} label="Objektsnummer" placeholder="1001" />}
          </form.Field>
          <form.Field name="kind">
            {(field) => (
              <div className="grid gap-1.5">
                <Label htmlFor={field.name}>Typ</Label>
                <Select
                  value={field.state.value}
                  onValueChange={(v) => field.handleChange(v as UnitKind)}
                >
                  <SelectTrigger id={field.name} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {unitKinds.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {unitKindLabels[kind]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError field={field} />
              </div>
            )}
          </form.Field>
        </div>
        <form.Field
          name="area"
          validators={{
            onSubmit: ({ value }) => {
              if (!value.trim()) return undefined
              const n = Number(value.replace(',', '.'))
              return Number.isFinite(n) && n > 0 ? undefined : 'Ange yta i m², t.ex. 72,5'
            },
          }}
        >
          {(field) => <TextField field={field} label="Yta (m²)" placeholder="72,5" />}
        </form.Field>
        {create.error && <p className="text-destructive text-sm">{create.error.message}</p>}
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" disabled={isSubmitting} className="justify-self-start">
              Spara
            </Button>
          )}
        </form.Subscribe>
      </form>
    </section>
  )
}
