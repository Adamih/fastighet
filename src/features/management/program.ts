import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import { Clock, Effect, Exit } from 'effect'
import {
  agreement,
  auditEvent,
  managementAssignment,
  managementCodeAttempt,
  managementGrant,
  managementRequest,
  member,
  organization,
  user,
} from '#/db/schema'
import { requireFeature } from '#/features/billing/program'
import { stockholmDate } from '#/lib/dates'
import {
  cleanGrant,
  type Grant,
  grantFromLevels,
  isAssignmentRole,
  isEmptyGrant,
  levelsFromGrant,
  presetOf,
} from '#/lib/managed-access'
import { anyStoredJson } from '#/lib/schemas'
import { requireOwnCompany, requirePermission } from '#/server/authorize'
import { Conflict, NotFound } from '#/server/errors'
import { seesAllClients } from '#/server/focus'
import { sendEmail } from '#/server/mail/mailer'
import { inCompany, query } from '#/server/scoped'
import { CurrentOrganization, CurrentUser } from '#/server/services'
import { generateCode, hashCode, normalizeCode } from './codes'
import type {
  AcceptRequestInput,
  AssignStaffInput,
  RequestAccessInput,
  UpdateGrantInput,
} from './schemas'

// Management between companies. The managing side ("Kundbolag") asks for access and assigns its
// staff; the managed side ("Förvaltare") approves requests and changes or revokes grants. Both
// sides act only from their own company (`requireOwnCompany`), never from one they manage, so
// grants don't chain. These tables belong to two companies, so queries use `query` and filter on
// the current company's column explicitly.

const REQUEST_DAYS = 14
const MAX_FAILED_CODES_PER_HOUR = 10
const DAY = 24 * 60 * 60 * 1000

const readGrant = (permissions: string) => cleanGrant(anyStoredJson(permissions))

const ownCompany = (permission: 'client' | 'grant', action: 'read' | 'manage') =>
  Effect.gen(function* () {
    yield* requireOwnCompany
    yield* requirePermission({ [permission]: [action] })
    return yield* CurrentOrganization
  })

export type RequestStatus = 'open' | 'used' | 'withdrawn' | 'expired'

export const requestStatus = (
  r: { usedAt: Date | null; withdrawnAt: Date | null; expiresAt: Date },
  now: number,
): RequestStatus =>
  r.usedAt
    ? 'used'
    : r.withdrawnAt
      ? 'withdrawn'
      : r.expiresAt.getTime() <= now
        ? 'expired'
        : 'open'

// --- The managing company ("Kundbolag").

/** The companies this company manages, who works on each, its staff, and its requests. */
export const listClients = Effect.gen(function* () {
  const org = yield* ownCompany('client', 'read')
  const now = yield* Clock.currentTimeMillis

  const grants = yield* query((db) =>
    db
      .select({
        id: managementGrant.id,
        organizationId: organization.id,
        name: organization.name,
        permissions: managementGrant.permissions,
        since: managementGrant.createdAt,
      })
      .from(managementGrant)
      .innerJoin(organization, eq(organization.id, managementGrant.managedOrganizationId))
      .where(
        and(eq(managementGrant.managingOrganizationId, org.id), isNull(managementGrant.revokedAt)),
      )
      .orderBy(asc(organization.name)),
  )
  const assignments = yield* query((db) =>
    db
      .select({
        managedOrganizationId: managementAssignment.managedOrganizationId,
        userId: managementAssignment.userId,
        role: managementAssignment.role,
      })
      .from(managementAssignment)
      .where(eq(managementAssignment.managingOrganizationId, org.id)),
  )
  const staff = yield* query((db) =>
    db
      .select({ userId: user.id, name: user.name, email: user.email, role: member.role })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, org.id))
      .orderBy(asc(user.name)),
  )
  const requests = yield* query((db) =>
    db
      .select({
        id: managementRequest.id,
        label: managementRequest.label,
        email: managementRequest.email,
        permissions: managementRequest.permissions,
        createdAt: managementRequest.createdAt,
        expiresAt: managementRequest.expiresAt,
        usedAt: managementRequest.usedAt,
        withdrawnAt: managementRequest.withdrawnAt,
        usedBy: organization.name,
      })
      .from(managementRequest)
      .leftJoin(organization, eq(organization.id, managementRequest.usedByOrganizationId))
      .where(eq(managementRequest.managingOrganizationId, org.id))
      .orderBy(desc(managementRequest.createdAt))
      .limit(50),
  )

  const staffById = new Map(staff.map((s) => [s.userId, s]))
  return {
    clients: grants.map((g) => {
      const grant = readGrant(g.permissions)
      return {
        grantId: g.id,
        organizationId: g.organizationId,
        name: g.name,
        grant,
        preset: presetOf(grant),
        since: stockholmDate(g.since.getTime()),
        assigned: assignments
          .filter((a) => a.managedOrganizationId === g.organizationId)
          .flatMap((a) => {
            const s = staffById.get(a.userId)
            return s ? [{ userId: a.userId, name: s.name, role: a.role }] : []
          }),
      }
    }),
    staff: staff.map((s) => ({ ...s, seesAll: seesAllClients(s.role) })),
    requests: requests.map((r) => ({
      id: r.id,
      label: r.label,
      email: r.email,
      grant: readGrant(r.permissions),
      createdOn: stockholmDate(r.createdAt.getTime()),
      expiresOn: stockholmDate(r.expiresAt.getTime()),
      status: requestStatus(r, now),
      usedBy: r.usedBy,
    })),
  }
}).pipe(Effect.withSpan('management.listClients'))

/**
 * Creates a request for access and returns its code, which is shown only now. With an email, the
 * code and a link are sent there too; a failed email keeps the request (the code can be sent by
 * hand).
 */
export const requestAccess = Effect.fn('management.requestAccess')(function* (
  input: RequestAccessInput,
  origin: string,
) {
  const org = yield* ownCompany('client', 'manage')
  yield* requireFeature('clients')
  const me = yield* CurrentUser
  const grant = grantFromLevels(input.levels)
  if (isEmptyGrant(grant)) return yield* new Conflict({ message: 'Välj minst en behörighet.' })
  const now = yield* Clock.currentTimeMillis
  const code = generateCode()
  const expiresAt = new Date(now + REQUEST_DAYS * DAY)
  const email = input.email.trim() || null
  const codeHash = yield* Effect.promise(() => hashCode(code))
  const [created] = yield* query((db) =>
    db
      .insert(managementRequest)
      .values({
        managingOrganizationId: org.id,
        label: input.label.trim(),
        email,
        permissions: JSON.stringify(grant),
        codeHash,
        expiresAt,
        createdBy: me.id,
      })
      .returning({ id: managementRequest.id }),
  )
  const link = `${origin}/management?code=${encodeURIComponent(code)}`
  let emailed = false
  if (email) {
    const sent = yield* Effect.exit(
      sendEmail({
        to: email,
        template: 'managementRequest',
        props: {
          senderName: me.name,
          managingName: org.name,
          code,
          acceptUrl: link,
          expiresOn: stockholmDate(expiresAt.getTime()),
        },
      }),
    )
    if (Exit.isFailure(sent)) yield* Effect.logError(sent.cause)
    emailed = Exit.isSuccess(sent)
  }
  return {
    requestId: created.id,
    code,
    link,
    emailed,
    expiresOn: stockholmDate(expiresAt.getTime()),
  }
})

/** Withdraws a request that hasn't been used, so its code stops working. */
export const withdrawRequest = Effect.fn('management.withdrawRequest')(function* (
  requestId: string,
) {
  const org = yield* ownCompany('client', 'manage')
  const now = yield* Clock.currentTimeMillis
  const updated = yield* query((db) =>
    db
      .update(managementRequest)
      .set({ withdrawnAt: new Date(now) })
      .where(
        and(
          eq(managementRequest.id, requestId),
          eq(managementRequest.managingOrganizationId, org.id),
          isNull(managementRequest.usedAt),
          isNull(managementRequest.withdrawnAt),
        ),
      )
      .returning({ id: managementRequest.id }),
  )
  if (updated.length === 0) {
    return yield* new Conflict({ message: 'Förfrågan är redan använd eller återkallad.' })
  }
})

/**
 * Sets who works on a managed company, and their role there (null: their role at home). Replaces
 * the earlier list. Only the company's own members can be assigned.
 */
export const assignStaff = Effect.fn('management.assignStaff')(function* (input: AssignStaffInput) {
  const org = yield* ownCompany('client', 'manage')
  yield* requireFeature('clients')
  const [grant] = yield* query((db) =>
    db
      .select({ id: managementGrant.id })
      .from(managementGrant)
      .where(
        and(
          eq(managementGrant.managingOrganizationId, org.id),
          eq(managementGrant.managedOrganizationId, input.managedOrganizationId),
          isNull(managementGrant.revokedAt),
        ),
      ),
  )
  if (!grant) return yield* new NotFound({ entity: 'client', id: input.managedOrganizationId })

  const userIds = [...new Set(input.staff.map((s) => s.userId))]
  const members =
    userIds.length === 0
      ? []
      : yield* query((db) =>
          db
            .select({ userId: member.userId })
            .from(member)
            .where(and(eq(member.organizationId, org.id), inArray(member.userId, userIds))),
        )
  if (members.length !== userIds.length) {
    return yield* new Conflict({ message: 'Bara bolagets egna användare kan tilldelas.' })
  }
  // A built-in assignment role, or one of the company's own roles.
  const roleNames = [...new Set(input.staff.flatMap((s) => (s.role ? [s.role] : [])))]
  if (roleNames.some((r) => !isAssignmentRole(r) && !Object.hasOwn(org.customRoles, r))) {
    return yield* new Conflict({ message: 'Rollen finns inte längre. Välj en annan.' })
  }

  const scope = and(
    eq(managementAssignment.managingOrganizationId, org.id),
    eq(managementAssignment.managedOrganizationId, input.managedOrganizationId),
  )
  yield* query(async (db) => {
    const remove = db.delete(managementAssignment).where(scope)
    if (userIds.length === 0) return void (await remove)
    await db.batch([
      remove,
      db.insert(managementAssignment).values(
        userIds.map((userId) => ({
          managingOrganizationId: org.id,
          managedOrganizationId: input.managedOrganizationId,
          userId,
          role: input.staff.find((s) => s.userId === userId)?.role ?? null,
        })),
      ),
    ])
  })
})

/**
 * The manager ends its own access to a client, e.g. when the contract ends. The client sees it
 * in its log, since it happened to its data.
 */
export const endClient = Effect.fn('management.endClient')(function* (grantId: string) {
  const org = yield* ownCompany('client', 'manage')
  const me = yield* CurrentUser
  const [found] = yield* query((db) =>
    db
      .select({ managedOrganizationId: managementGrant.managedOrganizationId })
      .from(managementGrant)
      .where(
        and(
          eq(managementGrant.id, grantId),
          eq(managementGrant.managingOrganizationId, org.id),
          isNull(managementGrant.revokedAt),
        ),
      ),
  )
  if (!found) return yield* new NotFound({ entity: 'grant', id: grantId })
  const now = new Date(yield* Clock.currentTimeMillis)
  yield* query((db) =>
    db.batch([
      db
        .update(managementGrant)
        .set({ revokedAt: now, revokedBy: me.id })
        .where(eq(managementGrant.id, grantId)),
      db.insert(auditEvent).values({
        organizationId: found.managedOrganizationId,
        userId: me.id,
        userName: me.name,
        actorOrganizationId: org.id,
        actorOrganizationName: org.name,
        action: 'management.end_client',
        entityId: null,
      }),
    ]),
  )
})

// --- The managed company ("Förvaltare").

/** The companies that manage this one, with their permissions and who of their staff has access. */
export const listManagers = Effect.gen(function* () {
  const org = yield* ownCompany('grant', 'read')
  const grants = yield* query((db) =>
    db
      .select({
        id: managementGrant.id,
        managingOrganizationId: organization.id,
        name: organization.name,
        permissions: managementGrant.permissions,
        since: managementGrant.createdAt,
        grantedBy: user.name,
      })
      .from(managementGrant)
      .innerJoin(organization, eq(organization.id, managementGrant.managingOrganizationId))
      .leftJoin(user, eq(user.id, managementGrant.grantedBy))
      .where(
        and(eq(managementGrant.managedOrganizationId, org.id), isNull(managementGrant.revokedAt)),
      )
      .orderBy(asc(organization.name)),
  )
  const managingIds = grants.map((g) => g.managingOrganizationId)
  if (managingIds.length === 0) return []

  // Who at each manager reaches this company: everyone assigned, plus their owners and admins.
  const assigned = yield* query((db) =>
    db
      .select({
        managingOrganizationId: managementAssignment.managingOrganizationId,
        name: user.name,
        role: managementAssignment.role,
      })
      .from(managementAssignment)
      .innerJoin(user, eq(user.id, managementAssignment.userId))
      .innerJoin(
        member,
        and(
          eq(member.userId, managementAssignment.userId),
          eq(member.organizationId, managementAssignment.managingOrganizationId),
        ),
      )
      .where(
        and(
          eq(managementAssignment.managedOrganizationId, org.id),
          inArray(managementAssignment.managingOrganizationId, managingIds),
        ),
      )
      .orderBy(asc(user.name)),
  )
  const leaders = yield* query((db) =>
    db
      .select({ organizationId: member.organizationId, name: user.name, role: member.role })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(inArray(member.organizationId, managingIds))
      .orderBy(asc(user.name)),
  )

  return grants.map((g) => {
    const grant = readGrant(g.permissions)
    const all = leaders.filter(
      (l) => l.organizationId === g.managingOrganizationId && seesAllClients(l.role),
    )
    const allNames = new Set(all.map((l) => l.name))
    return {
      grantId: g.id,
      name: g.name,
      grant,
      preset: presetOf(grant),
      since: stockholmDate(g.since.getTime()),
      grantedBy: g.grantedBy,
      /** Owners and admins at the manager, who reach every company it manages. */
      leaders: all.map((l) => l.name),
      assigned: assigned
        .filter(
          (a) => a.managingOrganizationId === g.managingOrganizationId && !allNames.has(a.name),
        )
        .map((a) => ({ name: a.name, role: a.role })),
    }
  })
}).pipe(Effect.withSpan('management.listManagers'))

/** Finds a usable request by its code. Failed attempts count towards the limit. */
const findRequest = (input: string) =>
  Effect.gen(function* () {
    const me = yield* CurrentUser
    const now = yield* Clock.currentTimeMillis
    const [{ failed }] = yield* query((db) =>
      db
        .select({ failed: sql<number>`count(*)` })
        .from(managementCodeAttempt)
        .where(
          and(
            eq(managementCodeAttempt.userId, me.id),
            gt(managementCodeAttempt.createdAt, new Date(now - 60 * 60 * 1000)),
          ),
        ),
    )
    if (failed >= MAX_FAILED_CODES_PER_HOUR) {
      return yield* new Conflict({
        message: 'För många felaktiga koder. Vänta en stund och försök igen.',
      })
    }

    const code = normalizeCode(input)
    const codeHash = code ? yield* Effect.promise(() => hashCode(code)) : null
    const [request] = codeHash
      ? yield* query((db) =>
          db
            .select({
              id: managementRequest.id,
              managingOrganizationId: managementRequest.managingOrganizationId,
              managingName: organization.name,
              label: managementRequest.label,
              permissions: managementRequest.permissions,
              expiresAt: managementRequest.expiresAt,
              usedAt: managementRequest.usedAt,
              withdrawnAt: managementRequest.withdrawnAt,
            })
            .from(managementRequest)
            .innerJoin(organization, eq(organization.id, managementRequest.managingOrganizationId))
            .where(eq(managementRequest.codeHash, codeHash)),
        )
      : []
    if (!request || requestStatus(request, now) !== 'open') {
      yield* query((db) => db.insert(managementCodeAttempt).values({ userId: me.id }))
      return yield* new Conflict({
        message: 'Koden gäller inte. Kontrollera den, eller be förvaltaren om en ny.',
      })
    }
    return request
  })

/** Refuses a request from the company itself, or from a manager that already has access. */
const checkNewManager = (managingOrganizationId: string, managingName: string) =>
  Effect.gen(function* () {
    const org = yield* CurrentOrganization
    if (managingOrganizationId === org.id) {
      return yield* new Conflict({ message: 'Koden kommer från ert eget bolag.' })
    }
    const [existing] = yield* query((db) =>
      db
        .select({ id: managementGrant.id })
        .from(managementGrant)
        .where(
          and(
            eq(managementGrant.managedOrganizationId, org.id),
            eq(managementGrant.managingOrganizationId, managingOrganizationId),
            isNull(managementGrant.revokedAt),
          ),
        ),
    )
    if (existing) {
      return yield* new Conflict({
        message: `${managingName} har redan åtkomst. Ändra behörigheterna i listan i stället.`,
      })
    }
  })

/** What a code asks for, before the owner decides. */
export const previewRequest = Effect.fn('management.previewRequest')(function* (code: string) {
  yield* ownCompany('grant', 'manage')
  const request = yield* findRequest(code)
  yield* checkNewManager(request.managingOrganizationId, request.managingName)
  const grant = readGrant(request.permissions)
  return {
    managingName: request.managingName,
    label: request.label,
    levels: levelsFromGrant(grant),
    preset: presetOf(grant),
    expiresOn: stockholmDate(request.expiresAt.getTime()),
  }
})

/** Approves a request: the managing company gets access with the permissions the owner chose. */
export const acceptRequest = Effect.fn('management.acceptRequest')(function* (
  input: AcceptRequestInput,
) {
  const org = yield* ownCompany('grant', 'manage')
  const me = yield* CurrentUser
  if (!input.processorAgreement) {
    return yield* new Conflict({
      message: 'Bekräfta att det finns ett personuppgiftsbiträdesavtal med förvaltaren.',
    })
  }
  const grant = grantFromLevels(input.levels)
  if (isEmptyGrant(grant)) return yield* new Conflict({ message: 'Välj minst en behörighet.' })
  const request = yield* findRequest(input.code)
  yield* checkNewManager(request.managingOrganizationId, request.managingName)

  const usedAt = new Date(yield* Clock.currentTimeMillis)
  const grantId = crypto.randomUUID()
  // One batch: the request is marked used only if still unused, and the grant is written only
  // for the request this company just used, so a code can never give access twice.
  yield* query((db) =>
    db.batch([
      db
        .update(managementRequest)
        .set({ usedAt, usedByOrganizationId: org.id })
        .where(
          and(
            eq(managementRequest.id, request.id),
            isNull(managementRequest.usedAt),
            isNull(managementRequest.withdrawnAt),
          ),
        ),
      db.insert(managementGrant).select(
        db
          .select({
            id: sql`${grantId}`.as('id'),
            managedOrganizationId: sql`${org.id}`.as('managed_organization_id'),
            managingOrganizationId: managementRequest.managingOrganizationId,
            permissions: sql`${JSON.stringify(grant)}`.as('permissions'),
            requestId: managementRequest.id,
            grantedBy: sql`${me.id}`.as('granted_by'),
            createdAt: sql`${usedAt.getTime()}`.as('created_at'),
            updatedAt: sql`null`.as('updated_at'),
            revokedAt: sql`null`.as('revoked_at'),
            revokedBy: sql`null`.as('revoked_by'),
          })
          .from(managementRequest)
          .where(
            and(
              eq(managementRequest.id, request.id),
              eq(managementRequest.usedByOrganizationId, org.id),
              eq(managementRequest.usedAt, usedAt),
            ),
          ),
      ),
    ]),
  )
  const [created] = yield* query((db) =>
    db
      .select({ id: managementGrant.id })
      .from(managementGrant)
      .where(eq(managementGrant.id, grantId)),
  )
  if (!created) {
    return yield* new Conflict({
      message: 'Koden gäller inte. Kontrollera den, eller be förvaltaren om en ny.',
    })
  }
  return { grantId, managingName: request.managingName }
})

const activeGrant = (grantId: string) =>
  Effect.gen(function* () {
    const org = yield* CurrentOrganization
    const [found] = yield* query((db) =>
      db
        .select({ id: managementGrant.id })
        .from(managementGrant)
        .where(
          and(
            eq(managementGrant.id, grantId),
            eq(managementGrant.managedOrganizationId, org.id),
            isNull(managementGrant.revokedAt),
          ),
        ),
    )
    if (!found) return yield* new NotFound({ entity: 'grant', id: grantId })
  })

/** Changes what a manager may do. Applies from their next request. */
export const updateGrant = Effect.fn('management.updateGrant')(function* (input: UpdateGrantInput) {
  yield* ownCompany('grant', 'manage')
  yield* activeGrant(input.grantId)
  const grant: Grant = grantFromLevels(input.levels)
  if (isEmptyGrant(grant)) {
    return yield* new Conflict({
      message: 'Välj minst en behörighet, eller återkalla åtkomsten.',
    })
  }
  const now = yield* Clock.currentTimeMillis
  yield* query((db) =>
    db
      .update(managementGrant)
      .set({ permissions: JSON.stringify(grant), updatedAt: new Date(now) })
      .where(eq(managementGrant.id, input.grantId)),
  )
})

/** Ends a manager's access. Its staff lose access on their next request. */
export const revokeGrant = Effect.fn('management.revokeGrant')(function* (grantId: string) {
  yield* ownCompany('grant', 'manage')
  yield* activeGrant(grantId)
  const me = yield* CurrentUser
  const now = yield* Clock.currentTimeMillis
  yield* query((db) =>
    db
      .update(managementGrant)
      .set({ revokedAt: new Date(now), revokedBy: me.id })
      .where(eq(managementGrant.id, grantId)),
  )
})

/**
 * What other companies' staff changed in this company, newest first. The company's own changes
 * are recorded too but not listed here.
 */
export const managerActivity = Effect.gen(function* () {
  const org = yield* ownCompany('grant', 'read')
  const rows = yield* query((db) =>
    db
      .select({
        id: auditEvent.id,
        at: auditEvent.createdAt,
        userName: auditEvent.userName,
        companyName: auditEvent.actorOrganizationName,
        action: auditEvent.action,
        entityId: auditEvent.entityId,
      })
      .from(auditEvent)
      .where(
        inCompany(
          auditEvent,
          org.id,
          sql`coalesce(${auditEvent.actorOrganizationId}, '') <> ${org.id}`,
        ),
      )
      .orderBy(desc(auditEvent.createdAt))
      .limit(100),
  )
  // Agreements link to a lease or a bostadsrätt, by kind.
  const agreementIds = [...new Set(rows.flatMap((r) => (r.entityId ? [r.entityId] : [])))]
  const kinds =
    agreementIds.length === 0
      ? []
      : yield* query((db) =>
          db
            .select({ id: agreement.id, kind: agreement.kind })
            .from(agreement)
            .where(inCompany(agreement, org.id, inArray(agreement.id, agreementIds))),
        )
  const kindOf = new Map(kinds.map((k) => [k.id, k.kind]))
  return rows.map((r) => ({
    ...r,
    at: r.at.getTime(),
    agreementKind: r.entityId ? (kindOf.get(r.entityId) ?? null) : null,
  }))
}).pipe(Effect.withSpan('management.managerActivity'))
