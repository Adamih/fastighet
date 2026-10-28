// Gives a user the Fastighet admin role (the admin dashboard at /admin, impersonation), or takes
// it away. The first admin is made here; after that, admins manage each other in the dashboard.
//
//   bun run admin:grant <email> [--revoke] [--remote]
//
// --remote runs against the production D1 database through Wrangler.
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const email = args.find((a) => !a.startsWith('--'))
if (!email || !/^[^\s@']+@[^\s@']+$/.test(email)) {
  console.error('Usage: bun run admin:grant <email> [--revoke] [--remote]')
  process.exit(1)
}
const role = args.includes('--revoke') ? "'user'" : "'admin'"
const sql = `UPDATE user SET role = ${role} WHERE email = '${email.toLowerCase()}'; SELECT email, role FROM user WHERE email = '${email.toLowerCase()}';`
const result = spawnSync(
  'bunx',
  [
    'wrangler',
    'd1',
    'execute',
    'DB',
    args.includes('--remote') ? '--remote' : '--local',
    '--command',
    sql,
  ],
  { stdio: 'inherit' },
)
process.exit(result.status ?? 1)
