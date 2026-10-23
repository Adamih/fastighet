import { defineConfig } from 'drizzle-kit'

// drizzle-kit only generates SQL here; wrangler applies it to D1 (see `db:migrate:*` scripts).
export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
})
