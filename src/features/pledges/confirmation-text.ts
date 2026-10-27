import type { ConfirmationKind } from './schemas'

// The förening's written confirmation to a lender that its pledge was registered in the apartment
// register, or released. Like avier, these are Swedish documents, so the text is Swedish literals;
// the printable page and the email both use it. Client-safe.

export interface ConfirmationDocument {
  readonly kind: ConfirmationKind
  /** The day the confirmation is written. */
  readonly writtenOn: string
  readonly association: {
    readonly name: string
    readonly organizationNumber: string | null
    readonly streetAddress: string | null
    readonly postalCode: string | null
    readonly city: string | null
    readonly email: string | null
    readonly phone: string | null
  }
  readonly ownership: { readonly number: number }
  readonly apartment: {
    readonly label: string
    readonly designation: string
    readonly address: string | null
  } | null
  readonly holders: readonly { readonly name: string; readonly sharePercent: number }[]
  readonly pledge: {
    readonly creditorName: string
    readonly creditorOrganizationNumber: string | null
    readonly reference: string | null
    readonly notifiedOn: string
    readonly releasedOn: string | null
    /** Its place among the pledges in force when written; null once released. */
    readonly priority: number | null
  }
}

const withNumber = (name: string, number: string | null) => (number ? `${name} (${number})` : name)

export function confirmationText(doc: ConfirmationDocument) {
  const { association: a, pledge: p } = doc
  const registered = doc.kind === 'registered'
  const facts: [string, string][] = [
    ['Bostadsrättsförening', withNumber(a.name, a.organizationNumber)],
    ['Bostadsrätt', `Nr ${doc.ownership.number}`],
    ...(doc.apartment
      ? ([
          [
            'Lägenhet',
            [`Lgh ${doc.apartment.label}`, doc.apartment.designation, doc.apartment.address]
              .filter(Boolean)
              .join(', '),
          ],
        ] as [string, string][])
      : []),
    [
      'Bostadsrättshavare',
      doc.holders
        .map((h) => (doc.holders.length > 1 ? `${h.name} (${h.sharePercent} %)` : h.name))
        .join(', '),
    ],
    ['Panthavare', withNumber(p.creditorName, p.creditorOrganizationNumber)],
    ...(p.reference ? ([['Er referens', p.reference]] as [string, string][]) : []),
    ['Underrättelsen kom in', p.notifiedOn],
    ...(registered && p.priority !== null
      ? ([['Företrädesordning', `${p.priority}`]] as [string, string][])
      : []),
    ...(!registered && p.releasedOn
      ? ([['Avregistrerad', p.releasedOn]] as [string, string][])
      : []),
  ]
  const paragraphs = registered
    ? [
        `${a.name} bekräftar att underrättelsen om pantsättning av bostadsrätten nedan kom in till föreningen ${p.notifiedOn} och har antecknats i lägenhetsförteckningen.`,
        ...(p.priority !== null
          ? [
              p.priority === 1
                ? 'Pantsättningen har första plats i företrädesordningen bland de pantsättningar som är registrerade på bostadsrätten.'
                : `Pantsättningen har plats ${p.priority} i företrädesordningen bland de pantsättningar som är registrerade på bostadsrätten. Ordningen följer den dag underrättelserna kom in.`,
            ]
          : []),
      ]
    : [
        `${a.name} bekräftar att pantsättningen av bostadsrätten nedan har avregistrerats ur lägenhetsförteckningen ${p.releasedOn}.`,
      ]
  return {
    title: registered ? 'Bekräftelse av pantsättning' : 'Bekräftelse av avregistrerad pantsättning',
    subject: `${registered ? 'Pantsättning registrerad' : 'Pantsättning avregistrerad'}: bostadsrätt ${doc.ownership.number} i ${a.name}${p.reference ? `, er ref. ${p.reference}` : ''}`,
    greeting: `Till ${p.creditorName}`,
    paragraphs,
    facts,
    signature: [`${a.name}, styrelsen`, doc.writtenOn],
    sender: [
      [a.streetAddress, [a.postalCode, a.city].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(', '),
      [a.email, a.phone].filter(Boolean).join(' · '),
    ].filter(Boolean),
  }
}

export type ConfirmationText = ReturnType<typeof confirmationText>
