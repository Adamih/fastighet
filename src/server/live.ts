import { env } from 'cloudflare:workers'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { db } from '#/db'
import { syncQuantity } from '#/features/billing/store'
import { fetchKpiFromScb } from '#/features/indexation/scb'
import { stripe, stripeConfigured } from '#/lib/stripe'
import { Mailer } from './mail/mailer'
import { mailer } from './mail/provider'
import { AppUrl, Billing, BillingError, Database, KpiFetchError, KpiSource } from './services'

// The composition root: the production implementation of every service that is the same for
// all requests. Request-scoped services (the user, the company in focus) are added by `runApp`.
// Tests build their own layer in `src/test/harness.ts`.

export const DatabaseLive = Layer.succeed(Database, db)

export const MailerLive = Layer.succeed(Mailer, mailer)

export const KpiSourceLive = Layer.succeed(KpiSource, {
  fetch: Effect.tryPromise({
    try: fetchKpiFromScb,
    catch: (cause) => new KpiFetchError({ cause }),
  }),
})

export const BillingLive = Layer.effect(
  Billing,
  Effect.gen(function* () {
    const database = yield* Database
    return {
      configured: stripeConfigured,
      syncQuantity: (organizationId: string) =>
        Effect.tryPromise({
          try: () => syncQuantity(database, stripe, organizationId),
          catch: (cause) => new BillingError({ cause }),
        }),
    }
  }),
).pipe(Layer.provide(DatabaseLive))

/** Better Auth's base URL is the app's public address. */
export const AppUrlLive = Layer.succeed(AppUrl, {
  origin: env.BETTER_AUTH_URL ? env.BETTER_AUTH_URL.replace(/\/$/, '') : null,
})

export const AppLive = Layer.mergeAll(
  DatabaseLive,
  MailerLive,
  KpiSourceLive,
  BillingLive,
  AppUrlLive,
)

/** Runs programs with `AppLive`, built once per isolate on first use. */
export const appRuntime = ManagedRuntime.make(AppLive)
