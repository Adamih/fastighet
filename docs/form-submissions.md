# Form submissions

Use `useAppForm` for field validation and `SubmissionForm` for the native form element.
Return/await the mutation in `onSubmit`; reset values or close the drawer only after it resolves.
Do not add an empty catch in `onSubmit`: TanStack must receive the rejection to mark the attempt
unsuccessful and release its submitting state. `SubmissionForm` catches it afterwards, shows a
focused error summary and keeps values for another attempt. Fields are disabled while submitting.

Use `useFormMutation` when a mutation has cache refresh or navigation work. Its `onSuccess` is
completion work: if that fails, the successful server result is retained. The recovery action
repeats completion without sending the write again. Use `throwOnError: true` for awaited query
invalidations. Closing/discarding a drawer resets its mutation and starts a new logical action
next time it opens.

Expected server errors are plain `AppError` data because Start serializes only an Error's
message. Domain conflicts, permission failures and validation failures have separate codes;
unexpected errors are logged and show a generic message. Session redirects still navigate.
Shared fields link validation messages to their inputs. Server input validation uses `validate`.

## Retry policy

- Queries retry transient failures at most twice. Business, permission and routing errors do not
  retry automatically. Drawer data and invoice previews also offer a manual reload.
- Mutations never retry automatically. Business-rule errors allow fixing values and submitting
  again. Authentication and permission errors require resolving access first.
- Property, unit, tenant, lease and invoice-run creation use durable request claims. The client
  keeps a key for the same submission until success or explicit reset. The server scopes it to
  company, user and operation and checks permissions before replaying any result.
- A completed claim replays its original result, including dates, after a lost response. A claim
  without a recorded result is uncertain: it cannot execute again with that key. Check the
  actual records before starting another action. There is intentionally no automatic timeout
  that releases an unfinished claim; a worker can fail after committing a write.
- Invoice creation and email delivery have separate outcomes. The run summary links failed or
  unconfirmed deliveries to their invoices for review. It never automatically resends email.
  A future real mail provider needs delivery idempotency/status reconciliation before automatic
  email retries are safe.

Apply migration `0004_flimsy_captain_stacy.sql` before running this code against another database.

## Drawer widths and columns

Drawers use the default desktop width (28rem). Opt into a wider desktop drawer per form:

```tsx
useFormDrawer({
  title: m.example_title(),
  size: 'wide', // 37.5rem, about 600px
  form: ({ close }) => <ExampleForm onDone={close} />,
})
```

Desktop widths leave at least 3rem of the viewport outside the drawer for dismissal. Narrow
windows use the existing mobile bottom drawer, which keeps space above it for dismissal.
Headers, scrolling, footers and unsaved-change guards are shared by both sizes.

The body is a named `form-drawer` query container. Forms own their column layout; base it on
actual drawer space rather than viewport breakpoints, for example:

```tsx
<div className="grid gap-4 @min-[32rem]/form-drawer:grid-cols-2">
  {/* Fields stack below 32rem of available content width. */}
</div>
```
