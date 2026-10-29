import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Mail, Phone } from 'lucide-react'
import { PortalContactForm } from '#/features/portal/contact-form'
import { portalContactQuery } from '#/features/portal/portal-functions'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/portal/_portal/uppgifter')({
  loader: ({ context }) => context.queryClient.ensureQueryData(portalContactQuery()),
  component: ContactPage,
})

function ContactPage() {
  const { data } = useSuspenseQuery(portalContactQuery())
  return (
    <div className="grid gap-5">
      <h1 className="font-bold text-2xl tracking-tight md:text-3xl">{m.portal_nav_contact()}</h1>
      {data.parties.map((party) => (
        <section key={party.id} className="grid gap-3 rounded-xl border bg-card p-4">
          <h2 className="font-semibold">{party.name}</h2>
          {data.editsAllowed ? (
            <PortalContactForm party={party} />
          ) : (
            <div className="grid gap-1 text-sm">
              <span>{party.email ?? '–'}</span>
              <span>{party.phone ?? '–'}</span>
              <span>
                {[party.streetAddress, [party.postalCode, party.city].filter(Boolean).join(' ')]
                  .filter(Boolean)
                  .join(', ') || '–'}
              </span>
              <p className="pt-1 text-muted-foreground">
                {m.portal_contact_no_edits({ company: data.company.name })}
              </p>
            </div>
          )}
        </section>
      ))}
      <section className="grid gap-1 rounded-xl border bg-card p-4">
        <h2 className="font-semibold">{m.portal_contact_login()}</h2>
        <p className="text-sm">{data.loginEmail}</p>
        <p className="text-muted-foreground text-sm">{m.portal_contact_login_hint()}</p>
      </section>
      <section className="grid gap-2 rounded-xl border bg-card p-4">
        <h2 className="font-semibold">
          {m.portal_contact_company({ company: data.company.name })}
        </h2>
        {data.company.email && (
          <a href={`mailto:${data.company.email}`} className="flex items-center gap-2 text-sm">
            <Mail aria-hidden="true" className="size-4" />
            {data.company.email}
          </a>
        )}
        {data.company.phone && (
          <a
            href={`tel:${data.company.phone.replace(/[^\d+]/g, '')}`}
            className="flex items-center gap-2 text-sm"
          >
            <Phone aria-hidden="true" className="size-4" />
            {data.company.phone}
          </a>
        )}
        {!data.company.email && !data.company.phone && (
          <p className="text-muted-foreground text-sm">{m.portal_contact_company_none()}</p>
        )}
      </section>
    </div>
  )
}
