import { env } from 'cloudflare:workers'
import { db } from '#/db'
import { createAuth } from './auth-config'

export const auth = createAuth(db, {
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
})
