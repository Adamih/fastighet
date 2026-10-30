import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { Schema } from 'effect'
import { auth } from '#/lib/auth'
import { validate } from '#/server/validate'

// Development only: signs in to Mina sidor as a seeded portal user without reading the code from
// the mock mailer. The code is made on the server and used through Better Auth's emailed-code
// sign-in, so the session is a Mina sidor session like any other. A production build refuses it,
// and it only takes the seeded logins.

export const devPortalSignInFn = createServerFn({ method: 'POST' })
  .validator(validate(Schema.Struct({ user: Schema.Literals(['tenant', 'brf']) })))
  .handler(async ({ data }) => {
    if (!import.meta.env.DEV) throw notFound()
    const { SEED_USERS } = await import('../../../scripts/db-seed-constants')
    const email = SEED_USERS[data.user].email
    const otp = await auth.api.createVerificationOTP({ body: { email, type: 'sign-in' } })
    await auth.api.signInEmailOTP({ body: { email, otp }, headers: getRequest().headers })
    return null
  })
