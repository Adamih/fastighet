# Fastighet

See README.md for stack, scripts and layout. UI copy is Swedish; code and comments are English.

## Rules

- **Tenant isolation.** Every domain table has `organizationId`. Read and write domain tables only through `orgQuery` (`src/server/scoped.ts`) and always filter on the id it passes in. D1/SQLite has no row-level security, so this is the only guard.
- **Server code goes through Effect.** Server functions are thin: validate input with an Effect Schema (`Schema.toStandardSchemaV1`) and call `runApp(program)`. Business logic lives in `features/*/program.ts` as Effect programs that use `Database`, `CurrentUser` and `CurrentOrganization`.
- **Active company.** `runApp` checks on every request that the user still belongs to the session's active company. If not (for example after being removed), it switches the session to the user's oldest remaining company, or fails with `NoActiveOrganization` when there is none. Route guards use `getSessionFn().hasOrganization`, which reads the member table, never the session's `activeOrganizationId`.
- **Team permissions.** Use Better Auth's organization APIs for role changes, member removal and invitations. Its endpoints enforce permissions and creator-role protections; `memberActions` mirrors those rules for the UI, including multi-role owners. Self-actions stay hidden in the team UI. Leaving organizations is disabled server-side through Better Auth's `disabledPaths`.
- **Permissions.** `src/lib/permissions.ts` defines Better Auth's access-control statements and roles. Permission evaluation uses Better Auth: `auth.api.hasPermission` on the server and `authClient.organization.checkRolePermission` in the UI. Start domain programs with `yield* requirePermission(...)` (`src/server/authorize.ts`): `read` to view a resource, `manage` to create, edit, delete or act on it. Missing access fails with `Forbidden`. Owners and admins have full access; members manage daily work and can only read settings. Deleting still requires the history checks below.
  - Check every affected resource: booking payments requires `payment:manage` and `invoice:manage`; invoice runs also require `lease:read`. Embedded optional data requires read access to its resource (`hasPermission`); invoice seller details use the internal settings loader.
  - Gate navigation and controls with `useCan()` and disable edit forms without manage access. UI checks mirror server checks; they never replace them. Team listing is open to all members. Better Auth enforces member/invitation permissions and owner protections.
- **Deleting keeps history.**
  - Delete a record only when nothing depends on it, and check first so the user gets a `Conflict` explaining why. Foreign keys are only the backstop.
  - Units that have ever been on a lease, tenants with leases, and leases with invoices can't be deleted. Terminate the lease instead.
  - Edits never touch issued invoices, which keep their own copy of the details.
- **Phone width.** Every page must work at 390 px. Use `src/components/responsive.tsx`:
  - Pair each data table (`className={desktopTableClass}`, shown from `md` up) with a `MobileList` of the same rows, using `MobileListLink` when the whole row opens something.
  - Use `PageHeader` for the title and its primary action, and `FilterChips` for filters (they scroll sideways on phones).
  - On phones, give action buttons and inputs 44 px height (`h-11 sm:h-9`) and make form submit buttons full width.
  - Keep the existing theme tokens; don't add colors for mobile.
- **Forms.** Each entity has one form component (`features/*/…-form.tsx`), used for both create and edit. Edit pages that live under a detail URL use a trailing underscore (`$leaseId_.edit.tsx`) so they don't render inside the detail page.
  - Build forms with `useAppForm` from `src/components/form.tsx`: fields as `<form.AppField name=…>{(f) => <f.TextField … />}</form.AppField>` (also `SelectField`, `SegmentedField`, `SwitchField`), the button as `<form.AppForm><form.SubmitButton>…</form.SubmitButton></form.AppForm>`. Fields create their own ids. Inside a `FormDrawer` the submit button becomes a sticky footer and the drawer asks before discarding unsaved changes.
  - Forms opened in a drawer get a hook in the same file, built on `useFormDrawer` (`src/components/form-drawer.tsx`), e.g. `useAddTenantDrawer` in `tenant-form.tsx`. The hook owns the mutation and cache refresh. Pages call `x.open` from a button and render `{x.drawer}` once; the drawer slides in from the right on desktop and from the bottom on phones.
  - A page's "Lägg till …" button uses `<Button size="fab">`: floating on phones, ordinary from `md` up. Such pages leave room at the bottom on phones (`pb-20 md:pb-0`).
- **Errors.** Expected failures are tagged errors from `src/server/errors.ts`. `runApp` maps them: `Unauthenticated` redirects to /login, `NoActiveOrganization` to /onboarding, `NotFound` becomes a 404, `Forbidden` shows a generic "no permission" message, and a `Conflict` message is shown to the user. Anything else is logged and replaced with a generic message.
- **Invoices are accounting records.** Never delete or renumber them:
  - Correct a mistake by voiding an unpaid invoice that has no credit notes (it keeps its number), or with a credit note (kreditfaktura).
  - Credit notes (`credit_note`) are accounting records too: never deleted, numbered without gaps per company in their own series, recipient details copied from the invoice. They credit all or part of an invoice (`features/invoicing/credit.ts`, unit-tested). Creating one adds its total to `invoice.creditedOre` in the same batch; what is still owed is `totalOre - creditedOre`, which payment matching and the outstanding totals use. A fully credited unpaid invoice has status `credited`.
  - A credit note on an invoice that was already paid has `refund` set: the amount is paid back, and "Registrera återbetalning" records `refundedOn` (needs `invoice:manage` and `payment:manage`). Undoing the payment turns unrefunded credits back into reductions; it is blocked once a refund is recorded.
  - A voided or fully credited avi no longer counts for its period (`inForce` in `features/invoicing/correction.ts`). "Ny avi för perioden" issues one corrected avi, linked by `replacesInvoiceId`. The partial unique index on lease and period enforces this. Invoice runs still skip any period that has an avi, so they never reissue a corrected period.
  - Numbers run without gaps per company, and the OCR is the number plus a Luhn digit.
  - Recipient details are copied onto the invoice when it is issued.
  - Period, rent, VAT and due-date rules live in `src/features/invoicing/rules.ts` and are unit-tested. Change them there.
- **Payments** come from camt.054 bank files (`src/features/payments/camt054.ts`). Like invoices, they're never deleted:
  - Their status moves between matched, review, unmatched and ignored.
  - A bank reference is unique per company, which makes re-importing safe.
  - Only an exact OCR and amount on an open invoice marks it paid automatically (`matching.ts`). Everything else waits for a person.
  - `payment.marksInvoicePaid` records which payment paid an invoice. Undoing either side (the payment, or "Ångra betalning" on the invoice) reopens the invoice and frees the payment.
- **Client bundle.** Keep Effect programs, `#/db` and `#/lib/auth` out of client code. Import them only from server function handlers. Client-safe constants (e.g. `unit-kinds.ts`) live in separate modules.
- **Shared rules.** Pure logic that both sides need (e.g. `features/leases/terms.ts`) must not import server modules, so the client can use them for previews.
- **Money** is integer öre, never floats. Parse and format with `src/lib/money.ts`.
- **Dates** are ISO strings (`"2026-10-23"`) in the database, the API and the UI. Use the helpers in `src/lib/dates.ts`. On the server, get today's date from the `today` Effect (`src/server/today.ts`), which uses Stockholm time. Never use `new Date()`, because Workers run in UTC.
- Shared field schemas (`OptionalText`, `PostalCode`, `IsoDate`, …) and `blankToNull` live in `src/lib/schemas.ts`.
- **Email.** Send with `sendEmail({ to, template, props })` from `src/server/mail/mailer.ts`. It renders the react-email template and delivers it through the `Mailer` service, which `runApp` provides. Only the mock provider exists so far (`src/server/mail/provider.ts`). It logs emails, including links, and sends nothing.
  - A new template is a file in `src/emails/` that exports a default component, `Props`, `subject(props)` and `PreviewProps`. Register it in `src/server/mail/templates.ts`.
  - Use inline styles only. Many email clients ignore stylesheets.
  - Better Auth sends verification, password-reset and invitation emails through `deliverEmail` (`src/lib/auth.ts`). It hands the send to `waitUntil` and never awaits it, so response time does not reveal whether an account exists.
  - `src/lib/auth-config.ts` must stay loadable by the Better Auth CLI, so it takes `deliverEmail` as a parameter instead of importing the mailer.
- **Auth UI.** Show Better Auth errors through `authErrorMessage` (`src/lib/auth-errors.ts`), which maps error codes to Swedish. Pass every post-login `redirect` through `safeRedirect`.
- **Seed data** (`scripts/db-seed.ts`) writes through the app's Drizzle schema and pure rules, so a schema change that breaks it fails `bun run typecheck`.
  - When you add a feature, give it seed data and keep `bun run db:reset` working.
  - Seeded logins are in `scripts/db-seed-constants.ts`.
- **Schema changes:** edit `src/db/schema.ts`, run `bun run db:generate`, then `bun run db:migrate:local`. Never edit `src/db/auth-schema.ts` by hand; use `bun run auth:generate`.
- Use `.validator()` on `createServerFn` (this Start version has no `inputValidator`).
- Server functions are CSRF-protected (same-origin only). When calling them outside the browser, send `Sec-Fetch-Site: same-origin`.
- Before finishing: `bun run typecheck && bun run check && bun test`.
