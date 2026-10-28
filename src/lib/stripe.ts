import { env } from 'cloudflare:workers'
import Stripe from 'stripe'

// Stripe for subscriptions (Better Auth's Stripe plugin and `features/billing`). The keys are
// optional secrets: without them the app runs, the plan page says payment isn't set up, and
// checkout fails with Stripe's error.
const secrets = env as Env & { STRIPE_SECRET_KEY?: string; STRIPE_WEBHOOK_SECRET?: string }

export const stripeConfigured = Boolean(secrets.STRIPE_SECRET_KEY)

export const stripe = new Stripe(secrets.STRIPE_SECRET_KEY || 'sk_test_unconfigured', {
  httpClient: Stripe.createFetchHttpClient(),
})

export const stripeWebhookSecret = secrets.STRIPE_WEBHOOK_SECRET ?? ''
