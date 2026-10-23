# Fastighet

See README.md for stack, scripts and layout. UI copy is Swedish; code and comments are English.

## Rules

- **Tenant isolation.** Every domain table has `organizationId`. Read and write domain tables only through `orgQuery` (`src/server/scoped.ts`) and always filter on the id it passes in. D1/SQLite has no row-level security, so this is the only guard.
- **Server code goes through Effect.** Server functions are thin: validate input with an Effect Schema (`Schema.toStandardSchemaV1`) and call `runApp(program)`. Business logic lives in `features/*/program.ts` as Effect programs that use `Database`, `CurrentUser` and `CurrentOrganization`.
- **Errors.** Expected failures are tagged errors from `src/server/errors.ts`. `runApp` maps them: `Unauthenticated` redirects to /login, `NoActiveOrganization` to /onboarding, `NotFound` becomes a 404, and a `Conflict` message is shown to the user. Anything else is logged and replaced with a generic message.
- **Client bundle.** Keep Effect programs, `#/db` and `#/lib/auth` out of client code. Import them only from server function handlers. Client-safe constants (e.g. `unit-kinds.ts`) live in separate modules.
- **Shared rules.** Pure logic that both sides need (e.g. `features/leases/terms.ts`) must not import server modules, so the client can use them for previews.
- **Money** is integer öre, never floats. Parse and format with `src/lib/money.ts`.
- **Dates** are ISO strings (`"2026-10-23"`) in the database, the API and the UI. Use the helpers in `src/lib/dates.ts`. On the server, get today's date from the `today` Effect (`src/server/today.ts`), which uses Stockholm time. Never use `new Date()`, because Workers run in UTC.
- Shared field schemas (`OptionalText`, `PostalCode`, `IsoDate`, …) and `blankToNull` live in `src/lib/schemas.ts`.
- **Schema changes:** edit `src/db/schema.ts`, run `bun run db:generate`, then `bun run db:migrate:local`. Never edit `src/db/auth-schema.ts` by hand; use `bun run auth:generate`.
- Use `.validator()` on `createServerFn` (this Start version has no `inputValidator`).
- Server functions are CSRF-protected (same-origin only). When calling them outside the browser, send `Sec-Fetch-Site: same-origin`.
- Before finishing: `bun run typecheck && bun run check && bun test`.
