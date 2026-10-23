// Logins created by `bun run db:seed`. Local development only; never use these anywhere else.

export const SEED_PASSWORD = 'fastighet-dev-1234'

export const SEED_USERS = {
  owner: { email: 'agare@fastighet.test', name: 'Olle Ägare' },
  member: { email: 'medlem@fastighet.test', name: 'Maja Medlem' },
} as const
