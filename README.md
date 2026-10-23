# Fastighet

Property management SaaS for small Swedish real estate companies.

**Stack:** TanStack Start (React) on Cloudflare Workers · Effect 4 on the server · Drizzle ORM + Cloudflare D1 (SQLite) · Better Auth (email/password + organizations) · TanStack Query/Form · Tailwind + shadcn/ui · Bun.

## Getting started

```bash
mise install                     # installs bun
bun install
cp .dev.vars.example .dev.vars   # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
bun run db:reset                 # creates the local D1 database under .wrangler/ and seeds it
bun run dev                      # http://localhost:3000
```

### Seed data

`bun run db:reset` deletes the local database, applies every migration and runs `bun run db:seed`. It touches only the local database. Stop `bun run dev` first and start it again afterwards, because the dev server keeps the old database file open. Wrangler asks you to confirm the migrations.

The seed creates Exempel Fastigheter AB with dates relative to today:

- **Logins:** `agare@fastighet.test` (owner) and `medlem@fastighet.test` (member), already verified. The password is `SEED_PASSWORD` in `scripts/db-seed-constants.ts`.
- **Settings:** a made-up bankgiro and organisation number that pass their checksums, plus an address.
- **Properties:** Kv. Lärkan and Kv. Falken, with 8 units. Some are vacant.
- **Tenants and leases:**
  - an open-ended apartment
  - commercial premises with parking: fixed term with extension, yearly rent invoiced quarterly, VAT
  - a terminated lease
  - a lease that starts next month, for a tenant without email
- **Invoice:** one rent notice for this month, emailed and unpaid, so it shows as overdue.

`bun run db:seed` on its own refuses to run on a database that already has users.

To start from scratch instead, run `bun run db:migrate:local`, sign up at `/login`, create a company at `/onboarding`, then add properties and units. To send rent notices (`/invoices`), first enter a bankgiro number under Inställningar.

Email addresses must be verified before signing in. No real email is sent yet: the mock mailer prints each email to the `bun run dev` console. Open the verification, password-reset or invitation link from there.

## Scripts

| Script | What it does |
|---|---|
| `dev` / `build` / `preview` | Vite dev server (runs in workerd), production build, preview the build |
| `deploy` | Build and `wrangler deploy` |
| `typecheck` · `check` · `check:fix` · `test` | `tsc`, Biome lint + format, `bun test` |
| `db:generate` | Generate a SQL migration in `drizzle/` from `src/db/schema.ts` |
| `db:migrate:local` / `db:migrate:remote` | Apply migrations to local / remote D1 via wrangler |
| `db:reset` | Wipe the local D1 database, migrate and seed it (never touches remote) |
| `db:seed` | Fill an empty local database with demo data (`scripts/db-seed.ts`) |
| `auth:generate` | Regenerate `src/db/auth-schema.ts` after changing Better Auth plugins |
| `cf-typegen` | Regenerate `worker-configuration.d.ts` after editing `wrangler.jsonc` |
| `email:dev` | react-email preview server for `src/emails` at http://localhost:3001 |

## Layout

```
src/
  db/                 Drizzle schema (domain tables + generated Better Auth tables) and the D1 client
  lib/                Better Auth server config (auth-config.ts / auth.ts) and client
  server/             Effect plumbing: services, typed errors, org-scoped queries, runApp()
  server/mail/        Mailer service, sendEmail(), template registry, mock provider
  emails/             react-email templates (Swedish); _components/ holds the shared layout
  features/<name>/    schemas.ts (Effect Schema, shared client/server), program.ts (Effect),
                      functions.ts (server functions + query options)
  routes/             File routes. _app.tsx is the signed-in layout; login/onboarding are public
```

A request flows: route loader → TanStack Query → server function (validates input with an Effect Schema) → `runApp(program)` → Effect program using `orgQuery` → D1.

## First deploy

1. `bunx wrangler d1 create fastighet` and put the returned id in `wrangler.jsonc`.
2. Set `BETTER_AUTH_URL` in `wrangler.jsonc` `vars` to the production URL, then `bunx wrangler secret put BETTER_AUTH_SECRET`.
3. `bun run db:migrate:remote && bun run deploy`.
