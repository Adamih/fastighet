// KPI from SCB's open API (PxWebApi 2). Since January 2026 KPI is set with 2020=100; SCB also
// publishes those values rebased to 1980=100 (table TAB6792, series 000007MM) through December
// 2030, so index clauses written against 1980=100 keep working. Earlier months are in the
// migration that created the `kpi` table.

export const SCB_KPI_URL =
  'https://api.scb.se/OV0104/v2beta/api/v2/tables/TAB6792/data?lang=sv&outputformat=json-stat2' +
  '&valuecodes%5BContentsCode%5D=000007MM&valuecodes%5BTid%5D=*'

interface JsonStat {
  readonly value: readonly (number | null)[]
  readonly dimension: {
    readonly Tid: { readonly category: { readonly index: Record<string, number> } }
  }
}

/** Months with a value, as "2026-10" and the index times 100. Unpublished months are left out. */
export function parseKpi(body: unknown): { month: string; valueHundredths: number }[] {
  const data = body as JsonStat
  const index = data?.dimension?.Tid?.category?.index
  if (!index || !Array.isArray(data.value)) throw new Error('Unexpected KPI response from SCB')
  return Object.entries(index).flatMap(([period, i]) => {
    const value = data.value[i]
    const match = /^(\d{4})M(\d{2})$/.exec(period)
    if (value === null || value === undefined || !match) return []
    return [{ month: `${match[1]}-${match[2]}`, valueHundredths: Math.round(value * 100) }]
  })
}

export async function fetchKpiFromScb() {
  const response = await fetch(SCB_KPI_URL, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`SCB answered ${response.status}`)
  return parseKpi(await response.json())
}
