import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { Schema } from 'effect'
import { appError } from '#/lib/app-errors'
import { auth } from '#/lib/auth'
import { runPortalPublic } from '#/server/portal'
import { getSessionOrNull } from '#/server/run'
import { validate } from '#/server/validate'
import { acceptPortalInvitation, previewPortalInvitation } from './accept-program'

// Mina sidor's public server functions: the invitation page, before anyone is signed in.

const CodeInput = Schema.Struct({ code: Schema.String.check(Schema.isMaxLength(200)) })

export const previewPortalInvitationFn = createServerFn({ method: 'GET' })
  .validator(validate(CodeInput))
  .handler(({ data }) => runPortalPublic(previewPortalInvitation(data.code)))

/**
 * Accepts the invitation and signs the person in to Mina sidor: through Better Auth's emailed-code
 * sign-in with a code made on the server, so the new session is a Mina sidor session like any
 * other (`src/lib/workspace.ts`).
 */
export const acceptPortalInvitationFn = createServerFn({ method: 'POST' })
  .validator(validate(CodeInput))
  .handler(async ({ data }) => {
    const session = await getSessionOrNull()
    const accepted = await runPortalPublic(
      acceptPortalInvitation(data.code, session?.user.email ?? null),
    )
    try {
      const otp = await auth.api.createVerificationOTP({
        body: { email: accepted.email, type: 'sign-in' },
      })
      await auth.api.signInEmailOTP({
        body: { email: accepted.email, otp },
        headers: getRequest().headers,
      })
    } catch (cause) {
      console.error('Could not sign in after accepting a portal invitation', cause)
      // The access is in place; signing in with an emailed code works.
      throw appError('unexpected', 'Inbjudan är godkänd. Logga in på Mina sidor med din e-post.')
    }
    return { organizationId: accepted.organizationId }
  })
