import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useAppForm } from '#/components/form'
import { SubmissionForm } from '#/components/submission-form'
import { useFormMutation } from '#/lib/form-mutation'
import { m } from '#/paraglide/messages'
import type { PortalContact } from './contact-program'
import { portalContactQuery, updatePortalContactFn } from './portal-functions'

type Party = PortalContact['parties'][number]

const validEmail = (value: string) =>
  !value.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())

/** A party's name and contact details in "Mina uppgifter", saved in place. */
export function PortalContactForm({ party }: { party: Party }) {
  const queryClient = useQueryClient()
  const [saved, setSaved] = useState(false)
  const save = useFormMutation({
    mutationFn: updatePortalContactFn,
    onSuccess: (updated) => queryClient.setQueryData(portalContactQuery().queryKey, updated),
  })
  const form = useAppForm({
    defaultValues: {
      name: party.name,
      email: party.email ?? '',
      phone: party.phone ?? '',
      streetAddress: party.streetAddress ?? '',
      postalCode: party.postalCode ?? '',
      city: party.city ?? '',
    },
    listeners: { onChange: () => setSaved(false) },
    onSubmit: async ({ value }) => {
      await save.mutateAsync({ data: { partyId: party.id, ...value } })
      setSaved(true)
    },
  })
  return (
    <SubmissionForm form={form} method="post" className="grid gap-4">
      <form.AppField
        name="name"
        validators={{
          onSubmit: ({ value }) => (value.trim() ? undefined : m.common_name_required()),
        }}
      >
        {(field) => (
          <field.TextField
            label={
              party.kind === 'company' ? m.portal_contact_company_name() : m.portal_contact_name()
            }
            autoComplete={party.kind === 'company' ? 'organization' : 'name'}
            hint={m.portal_contact_name_hint()}
          />
        )}
      </form.AppField>
      <form.AppField
        name="email"
        validators={{
          onSubmit: ({ value }) =>
            validEmail(value) ? undefined : m.portal_invite_email_invalid(),
        }}
      >
        {(field) => (
          <field.TextField
            label={m.portal_contact_email()}
            type="email"
            autoComplete="email"
            hint={m.portal_contact_email_hint()}
          />
        )}
      </form.AppField>
      <form.AppField name="phone">
        {(field) => <field.TextField label={m.common_phone()} type="tel" autoComplete="tel" />}
      </form.AppField>
      <form.AppField name="streetAddress">
        {(field) => (
          <field.TextField label={m.common_street_address()} autoComplete="street-address" />
        )}
      </form.AppField>
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4">
        <form.AppField
          name="postalCode"
          validators={{
            onSubmit: ({ value }) =>
              /^(\d{3} ?\d{2})?$/.test(value.trim()) ? undefined : m.portal_contact_postal_code(),
          }}
        >
          {(field) => (
            <field.TextField
              label={m.common_postal_code()}
              inputMode="numeric"
              autoComplete="postal-code"
            />
          )}
        </form.AppField>
        <form.AppField name="city">
          {(field) => <field.TextField label={m.common_city()} autoComplete="address-level2" />}
        </form.AppField>
      </div>
      <form.AppForm>
        <form.SubmitButton className="sm:w-auto sm:justify-self-start">
          {m.portal_contact_save()}
        </form.SubmitButton>
      </form.AppForm>
      {saved && (
        <p className="text-emerald-700 text-sm dark:text-emerald-300">{m.portal_contact_saved()}</p>
      )}
    </SubmissionForm>
  )
}
