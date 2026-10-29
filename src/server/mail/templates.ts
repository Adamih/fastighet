import ConfirmEmailChange, * as confirmEmailChange from '#/emails/ConfirmEmailChange'
import CreditNote, * as creditNote from '#/emails/CreditNote'
import ManagementRequest, * as managementRequest from '#/emails/ManagementRequest'
import OrganizationInvitation, * as organizationInvitation from '#/emails/OrganizationInvitation'
import PaymentReminder, * as paymentReminder from '#/emails/PaymentReminder'
import PledgeConfirmation, * as pledgeConfirmation from '#/emails/PledgeConfirmation'
import PortalInvitation, * as portalInvitation from '#/emails/PortalInvitation'
import RentAdjustment, * as rentAdjustment from '#/emails/RentAdjustment'
import RentInvoice, * as rentInvoice from '#/emails/RentInvoice'
import ResetPassword, * as resetPassword from '#/emails/ResetPassword'
import VerifyEmail, * as verifyEmail from '#/emails/VerifyEmail'

// Every sendable email, by name. Each template file exports a default component, its `Props`
// type and a `subject(props)` function (the react-email preview server only needs the component).

export const templates = {
  verifyEmail: { Component: VerifyEmail, subject: verifyEmail.subject },
  resetPassword: { Component: ResetPassword, subject: resetPassword.subject },
  confirmEmailChange: { Component: ConfirmEmailChange, subject: confirmEmailChange.subject },
  organizationInvitation: {
    Component: OrganizationInvitation,
    subject: organizationInvitation.subject,
  },
  rentInvoice: { Component: RentInvoice, subject: rentInvoice.subject },
  creditNote: { Component: CreditNote, subject: creditNote.subject },
  paymentReminder: { Component: PaymentReminder, subject: paymentReminder.subject },
  rentAdjustment: { Component: RentAdjustment, subject: rentAdjustment.subject },
  managementRequest: { Component: ManagementRequest, subject: managementRequest.subject },
  pledgeConfirmation: { Component: PledgeConfirmation, subject: pledgeConfirmation.subject },
  portalInvitation: { Component: PortalInvitation, subject: portalInvitation.subject },
} as const

export type TemplateName = keyof typeof templates
export type TemplateProps<T extends TemplateName> = Parameters<(typeof templates)[T]['subject']>[0]
