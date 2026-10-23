# Fastighet

Property management SaaS for small Swedish real estate companies.

**Stack:** TanStack Start (React) on Cloudflare Workers · Effect 4 on the server · Drizzle ORM + Cloudflare D1 (SQLite) · Better Auth (email/password + organizations) · TanStack Query/Form · Tailwind + shadcn/ui · Bun.

## Getting started

```bash
mise install                     # installs bun
bun install
cp .dev.vars.example .dev.vars   # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
bun run db:migrate:local         # creates the local D1 database under .wrangler/
bun run dev                      # http://localhost:3000
```

Sign up at `/login`, create a company at `/onboarding`, then add properties and units.

## Scripts

| Script | What it does |
|---|---|
| `dev` / `build` / `preview` | Vite dev server (runs in workerd), production build, preview the build |
| `deploy` | Build and `wrangler deploy` |
| `typecheck` · `check` · `check:fix` · `test` | `tsc`, Biome lint + format, `bun test` |
| `db:generate` | Generate a SQL migration in `drizzle/` from `src/db/schema.ts` |
| `db:migrate:local` / `db:migrate:remote` | Apply migrations to local / remote D1 via wrangler |
| `auth:generate` | Regenerate `src/db/auth-schema.ts` after changing Better Auth plugins |
| `cf-typegen` | Regenerate `worker-configuration.d.ts` after editing `wrangler.jsonc` |

## Layout

```
src/
  db/                 Drizzle schema (domain tables + generated Better Auth tables) and the D1 client
  lib/                Better Auth server config (auth-config.ts / auth.ts) and client
  server/             Effect plumbing: services, typed errors, org-scoped queries, runApp()
  features/<name>/    schemas.ts (Effect Schema, shared client/server), program.ts (Effect),
                      functions.ts (server functions + query options)
  routes/             File routes. _app.tsx is the signed-in layout; login/onboarding are public
```

A request flows: route loader → TanStack Query → server function (validates input with an Effect Schema) → `runApp(program)` → Effect program using `orgQuery` → D1.

## First deploy

1. `bunx wrangler d1 create fastighet` and put the returned id in `wrangler.jsonc`.
2. Set `BETTER_AUTH_URL` in `wrangler.jsonc` `vars` to the production URL, then `bunx wrangler secret put BETTER_AUTH_SECRET`.
3. `bun run db:migrate:remote && bun run deploy`.
