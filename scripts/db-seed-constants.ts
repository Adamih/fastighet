// Logins created by `bun run db:seed`. Local development only; never use these anywhere else.

export const SEED_PASSWORD = 'fastighet-dev-1234'

export const SEED_USERS = {
  owner: { email: 'agare@fastighet.test', name: 'Olle Ägare' },
  member: { email: 'medlem@fastighet.test', name: 'Maja Medlem' },
  /** The board of the seeded BRF, a separate company. */
  brf: { email: 'styrelse@brflinden.test', name: 'Siv Styrelse' },
  /** A property manager that manages both companies above through grants. */
  manager: { email: 'forvaltare@forvaltning.test', name: 'Frida Förvaltare' },
  /** Staff at the property manager, assigned to Brf Linden only, in its custom role. */
  managerStaff: { email: 'handlaggare@forvaltning.test', name: 'Hugo Handläggare' },
  /** Staff at the property manager: Brf Linden in full, Exempel Fastigheter read only. */
  managerViewer: { email: 'ekonom@forvaltning.test', name: 'Elin Ekonom' },
  /** A Fastighet admin (the admin dashboard, impersonation); member of no company. */
  admin: { email: 'admin@fastighet.test', name: 'Ada Admin' },
} as const
