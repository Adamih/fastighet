import { m } from '#/paraglide/messages'

// What the audit log records. Client-safe. Each server function that writes passes its action to
// `runApp`; the log stores the action key (never text), and the label is a message shown in the
// reader's language. The entity kind says what the recorded id points at.

export type AuditEntity =
  | 'property'
  | 'unit'
  | 'party'
  | 'agreement'
  | 'invoice'
  | 'creditNote'
  | 'payment'
  | null

/** Labels are messages, read when shown, so the log follows the UI language. */
const action = (label: () => string, entity: AuditEntity = null) => ({ label, entity })

export const auditActions = {
  'account.refund': action(m.audit_account_refund, 'party'),
  'account.undo_refund': action(m.audit_account_undo_refund, 'party'),
  'charge.change_base': action(m.audit_charge_change_base, 'agreement'),
  'charge.add_one_off': action(m.audit_charge_add_one_off, 'agreement'),
  'charge.remove_one_off': action(m.audit_charge_remove_one_off),
  'bookkeeping.settings': action(m.audit_bookkeeping_settings),
  'bookkeeping.export': action(m.audit_bookkeeping_export),
  'index_clause.set': action(m.audit_index_clause_set, 'agreement'),
  'index_clause.remove': action(m.audit_index_clause_remove, 'agreement'),
  'indexation.run': action(m.audit_indexation_run),
  'invoice.run': action(m.audit_invoice_run),
  'invoice.email': action(m.audit_invoice_email, 'invoice'),
  'invoice.mark_paid': action(m.audit_invoice_mark_paid, 'invoice'),
  'invoice.unmark_paid': action(m.audit_invoice_unmark_paid, 'invoice'),
  'invoice.void': action(m.audit_invoice_void, 'invoice'),
  'invoice.reissue': action(m.audit_invoice_reissue, 'invoice'),
  'credit_note.create': action(m.audit_credit_note_create, 'invoice'),
  'credit_note.email': action(m.audit_credit_note_email, 'creditNote'),
  'lease.create': action(m.audit_lease_create, 'agreement'),
  'lease.update': action(m.audit_lease_update, 'agreement'),
  'lease.terminate': action(m.audit_lease_terminate, 'agreement'),
  'lease.withdraw_termination': action(m.audit_lease_withdraw_termination, 'agreement'),
  'lease.delete': action(m.audit_lease_delete),
  'lease.change_from': action(m.audit_lease_change_from, 'agreement'),
  'management.request': action(m.audit_management_request),
  'management.withdraw_request': action(m.audit_management_withdraw_request),
  'management.assign': action(m.audit_management_assign),
  'management.accept': action(m.audit_management_accept),
  'management.update_grant': action(m.audit_management_update_grant),
  'management.revoke_grant': action(m.audit_management_revoke_grant),
  'management.end_client': action(m.audit_management_end_client),
  'ownership.create': action(m.audit_ownership_create, 'agreement'),
  'ownership.update': action(m.audit_ownership_update, 'agreement'),
  'ownership.transfer': action(m.audit_ownership_transfer, 'agreement'),
  'ownership.delete': action(m.audit_ownership_delete),
  'payment.import': action(m.audit_payment_import),
  'payment.assign': action(m.audit_payment_assign, 'payment'),
  'payment.ignore': action(m.audit_payment_ignore, 'payment'),
  'payment.undo': action(m.audit_payment_undo, 'payment'),
  'property.create': action(m.audit_property_create, 'property'),
  'property.update': action(m.audit_property_update, 'property'),
  'property.delete': action(m.audit_property_delete),
  'unit.create': action(m.audit_unit_create, 'unit'),
  'unit.update': action(m.audit_unit_update, 'unit'),
  'unit.delete': action(m.audit_unit_delete),
  'reminder.send': action(m.audit_reminder_send, 'invoice'),
  'reminder.send_many': action(m.audit_reminder_send_many),
  'settings.update': action(m.audit_settings_update),
  'settings.kind': action(m.audit_settings_kind),
  'tenant.create': action(m.audit_tenant_create, 'party'),
  'tenant.update': action(m.audit_tenant_update, 'party'),
  'tenant.delete': action(m.audit_tenant_delete),
} as const

export type AuditAction = keyof typeof auditActions

export const isAuditAction = (value: string): value is AuditAction =>
  Object.hasOwn(auditActions, value)

/** What a server function records: the action and, when there is one, the record it concerns. */
export interface Audit {
  readonly action: AuditAction
  /** Omitted for creates: the id of the result is used. */
  readonly entityId?: string | null
}

export const audit = (action: AuditAction, entityId?: string | null): Audit => ({
  action,
  entityId,
})
