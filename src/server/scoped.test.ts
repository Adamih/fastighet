import { expect, test } from 'bun:test'
import { Glob } from 'bun'
import { getTableColumns, is } from 'drizzle-orm'
import { SQLiteTable } from 'drizzle-orm/sqlite-core'
import * as authSchema from '#/db/auth-schema'
import * as schema from '#/db/schema'

// Programs filter domain tables on the company only through `inCompany` (scoped.ts), so a query
// without it stands out in review. This keeps a hand-written filter from creeping back in. The
// admin dashboard reads across companies on purpose and joins on the column instead.

const authTables = new Set<unknown>(Object.values(authSchema))
const domainTables = Object.entries(schema)
  .filter(
    ([, t]) => is(t, SQLiteTable) && !authTables.has(t) && 'organizationId' in getTableColumns(t),
  )
  .map(([name]) => name)

test('finds the domain tables', () => {
  expect(domainTables).toEqual(expect.arrayContaining(['invoice', 'agreement', 'party', 'posting']))
})

test('programs filter domain tables on the company only with inCompany', async () => {
  const filter = new RegExp(`\\b(?:eq|ne)\\(\\s*(${domainTables.join('|')})\\.organizationId\\b`)
  const offenders: string[] = []
  for await (const path of new Glob('src/{features,server,lib}/**/*.ts').scan('.')) {
    if (path.endsWith('.test.ts') || path.endsWith('server/scoped.ts')) continue
    if (path.startsWith('src/features/admin/')) continue
    const lines = (await Bun.file(path).text()).split('\n')
    lines.forEach((line, i) => {
      if (filter.test(line)) offenders.push(`${path}:${i + 1}: ${line.trim()}`)
    })
  }
  expect(offenders).toEqual([])
})
