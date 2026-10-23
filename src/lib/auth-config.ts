import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { asc, eq } from 'drizzle-orm'
import type { Db } from '#/db'
import * as schema from '#/db/schema'

// Kept free of `cloudflare:workers` so the Better Auth CLI can load it from Node.
export function createAuth(db: Db, options: { secret?: string; baseURL?: string }) {
  return betterAuth({
    secret: options.secret,
    baseURL: options.baseURL,
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    emailAndPassword: { enabled: true },
    databaseHooks: {
      session: {
        create: {
          // Land returning users in their first company instead of the onboarding screen.
          before: async (session) => {
            const [membership] = await db
              .select({ organizationId: schema.member.organizationId })
              .from(schema.member)
              .where(eq(schema.member.userId, session.userId))
              .orderBy(asc(schema.member.createdAt))
              .limit(1)
            return {
              data: { ...session, activeOrganizationId: membership?.organizationId ?? null },
            }
          },
        },
      },
    },
    plugins: [
      organization({ creatorRole: 'owner' }),
      // Must stay last so it can forward Set-Cookie headers from the other plugins.
      tanstackStartCookies(),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
