import OrganizationInvitation, * as organizationInvitation from '#/emails/OrganizationInvitation'
import ResetPassword, * as resetPassword from '#/emails/ResetPassword'
import VerifyEmail, * as verifyEmail from '#/emails/VerifyEmail'

// Every sendable email, by name. Each template file exports a default component, its `Props`
// type and a `subject(props)` function (the react-email preview server only needs the component).

export const templates = {
  verifyEmail: { Component: VerifyEmail, subject: verifyEmail.subject },
  resetPassword: { Component: ResetPassword, subject: resetPassword.subject },
  organizationInvitation: {
    Component: OrganizationInvitation,
    subject: organizationInvitation.subject,
  },
} as const

export type TemplateName = keyof typeof templates
export type TemplateProps<T extends TemplateName> = Parameters<(typeof templates)[T]['subject']>[0]
