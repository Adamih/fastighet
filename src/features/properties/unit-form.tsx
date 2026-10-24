import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { DeleteButton } from '#/components/delete-button'
import { Optional, optionsFrom, useAppForm } from '#/components/form'
import { useFormDrawer, useFormDrawerContext } from '#/components/form-drawer'
import { m } from '#/paraglide/messages'
import { createUnitFn, deleteUnitFn, propertyQuery, unitQuery, updateUnitFn } from './functions'
import { type UnitKind, unitKindLabels } from './unit-kinds'

export interface UnitValues {
  kind: UnitKind
  label: string
  areaSqm: number | null
}

export const emptyUnit: UnitValues = { kind: 'apartment', label: '', areaSqm: null }

const parseArea = (value: string) => (value.trim() ? Number(value.replace(',', '.')) : null)
const areaToInput = (area: number | null) => (area == null ? '' : String(area).replace('.', ','))

/** Shared by the create and edit unit drawers. */
export function UnitForm({
  defaultValues,
  submitLabel,
  onSubmit,
  error,
}: {
  defaultValues: UnitValues
  submitLabel: string
  onSubmit: (value: UnitValues) => Promise<unknown>
  error: Error | null
}) {
  const drawer = useFormDrawerContext()
  const form = useAppForm({
    defaultValues: {
      kind: defaultValues.kind,
      label: defaultValues.label,
      area: areaToInput(defaultValues.areaSqm),
    },
    onSubmit: ({ value }) =>
      onSubmit({ kind: value.kind, label: value.label, areaSqm: parseArea(value.area) }),
  })

  return (
    <form
      id={drawer?.formId}
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit().catch(() => {})
      }}
    >
      <fieldset className="grid gap-4">
        <div className="grid grid-cols-2 gap-4">
          <form.AppField
            name="label"
            validators={{
              onSubmit: ({ value }) => (value.trim() ? undefined : m.unit_form_label_required()),
            }}
          >
            {(field) => <field.TextField label={m.unit_form_label()} placeholder="1001" />}
          </form.AppField>
          <form.AppField name="kind">
            {(field) => (
              <field.SelectField label={m.common_kind()} options={optionsFrom(unitKindLabels)} />
            )}
          </form.AppField>
        </div>
        <form.AppField
          name="area"
          validators={{
            onSubmit: ({ value }) => {
              const area = parseArea(value)
              return area === null || (Number.isFinite(area) && area > 0)
                ? undefined
                : m.unit_form_area_invalid()
            },
          }}
        >
          {(field) => (
            <field.TextField
              label={<Optional>{m.unit_form_area()}</Optional>}
              placeholder="72,5"
              inputMode="decimal"
            />
          )}
        </form.AppField>
        {error && <p className="text-destructive text-sm">{error.message}</p>}
        <form.AppForm>
          <form.SubmitButton>{submitLabel}</form.SubmitButton>
        </form.AppForm>
      </fieldset>
    </form>
  )
}

/** "Lägg till objekt" on a property's page. */
export function useAddUnitDrawer(propertyId: string) {
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: createUnitFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: propertyQuery(propertyId).queryKey })
      await queryClient.invalidateQueries({ queryKey: ['units'] })
    },
  })
  return useFormDrawer({
    title: m.unit_add(),
    description: m.unit_add_description(),
    onClose: create.reset,
    form: ({ close }) => (
      <UnitForm
        defaultValues={emptyUnit}
        submitLabel={m.unit_save()}
        error={create.error}
        onSubmit={async (value) => {
          await create.mutateAsync({ data: { propertyId, ...value } })
          close()
        }}
      />
    ),
  })
}

/** "Ändra" on a unit's page. */
export function useEditUnitDrawer(
  unit: UnitValues & { id: string; propertyId: string; hasLeases: boolean },
) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: propertyQuery(unit.propertyId).queryKey })
    await queryClient.invalidateQueries({ queryKey: ['units'] })
    await queryClient.invalidateQueries({ queryKey: ['leases'] })
  }
  const update = useMutation({
    mutationFn: updateUnitFn,
    onSuccess: async (updated) => {
      queryClient.setQueryData(unitQuery(unit.id).queryKey, updated)
      await refresh()
    },
  })
  const remove = useMutation({
    mutationFn: deleteUnitFn,
    onSuccess: async () => {
      await navigate({ to: '/properties/$propertyId', params: { propertyId: unit.propertyId } })
      queryClient.removeQueries({ queryKey: unitQuery(unit.id).queryKey })
      await refresh()
    },
  })
  return useFormDrawer({
    title: m.unit_edit_title({ label: unit.label }),
    onClose: () => {
      update.reset()
      remove.reset()
    },
    form: ({ close }) => (
      <div className="grid gap-6">
        <UnitForm
          defaultValues={{ kind: unit.kind, label: unit.label, areaSqm: unit.areaSqm }}
          submitLabel={m.common_save_changes()}
          error={update.error}
          onSubmit={async (value) => {
            await update.mutateAsync({ data: { unitId: unit.id, ...value } })
            close()
          }}
        />
        <section className="grid gap-2 border-t pt-5 text-sm">
          <h2 className="font-medium">{m.common_delete()}</h2>
          {unit.hasLeases ? (
            <p className="text-muted-foreground">{m.unit_delete_blocked()}</p>
          ) : (
            <DeleteButton
              label={m.unit_delete()}
              question={m.unit_delete_confirm({ label: unit.label })}
              pending={remove.isPending}
              onConfirm={() => remove.mutate({ data: { unitId: unit.id } })}
            />
          )}
          {remove.error && <p className="text-destructive">{remove.error.message}</p>}
        </section>
      </div>
    ),
  })
}
