# Fastighet

Property management SaaS for small Swedish real estate companies.

**Stack:** TanStack Start (React) on Cloudflare Workers · Effect 4 on the server · Drizzle ORM + Cloudflare D1 (SQLite) · Better Auth (email/password + organizations) · TanStack Query/Form · Tailwind + shadcn/ui · Bun.

## Getting started

```bash
mise install                     # installs bun
mise run setup                   # installs dependencies and creates .dev.vars if missing
mise run db:reset                 # creates the local D1 database under .wrangler/ and seeds it
mise run dev                     # http://localhost:3000
```

### Seed data

`mise run db:reset` deletes the local database, applies every migration and runs `mise run db:seed`. It touches only the local database. Stop `mise run dev` first and start it again afterwards, because the dev server keeps the old database file open. Wrangler asks you to confirm the migrations.

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

`mise run db:seed` on its own refuses to run on a database that already has users.

To start from scratch instead, run `mise run db:migrate:local`, sign up at `/login`, create a company at `/onboarding`, then add properties and units. To send rent notices (`/invoices`), first enter a bankgiro number under Företagsuppgifter.

Email addresses must be verified before signing in. No real email is sent yet: the mock mailer prints each email to the `mise run dev` console. Open the verification, password-reset or invitation link from there.

Login (`/login`), signup (`/sign-up`), email verification and password recovery use Better Auth UI's `Auth` views with Swedish copy. Invitation destinations survive each step; staff accounts land in `/admin`, and customers without a company continue to onboarding. Development login shortcuts remain below the login card.

## Commands

Run `mise tasks` to list all tasks. Every package script has a matching mise task; the underlying Bun scripts remain available. `mise run setup` preserves an existing `.dev.vars` and creates a random `BETTER_AUTH_SECRET` only when that file is missing.

`bun install` also installs the Husky Git hooks. Before each commit, `bun run check:fix` runs Biome's formatting and safe fixes across the project, using the exclusions in `biome.json`. Remaining errors block the commit. Fixes stay in the working tree; stage them to include them in a commit.

| Task | What it does |
|---|---|
| `setup` | Install dependencies and create local auth configuration if missing |
| `verify` | Run type checking, lint and all tests in sequence |
| `dev` / `build` / `preview` | Vite dev server (runs in workerd), production build, preview the build |
| `deploy` | Build and `wrangler deploy` |
| `typecheck` · `check` · `check:fix` · `test` | `tsc`, Biome lint + format, `bun test` |
| `db:generate` | Generate a SQL migration in `drizzle/` from `src/db/schema.ts` |
| `db:migrate:local` / `db:migrate:remote` | Apply migrations to local / remote D1 via wrangler |
| `db:reset` | Wipe the local D1 database, migrate and seed it (never touches remote) |
| `db:seed` | Fill an empty local database with demo data (`scripts/db-seed.ts`) |
| `payments:sample` | Write `.wrangler/sample-camt054.xml`, a bank file paying the local open invoices (one 100 kr short, plus two unknown payments), to try the import under Betalningar |
| `auth:generate` | Regenerate `src/db/auth-schema.ts` after changing Better Auth plugins |
| `generate-routes` | Regenerate TanStack Router routes |
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
3. `mise run db:migrate:remote && mise run deploy`.
