export const unitKinds = ['apartment', 'commercial', 'parking', 'storage'] as const
export type UnitKind = (typeof unitKinds)[number]

export const unitKindLabels: Record<UnitKind, string> = {
  apartment: 'Bostad',
  commercial: 'Lokal',
  parking: 'Parkering',
  storage: 'Förråd',
}
