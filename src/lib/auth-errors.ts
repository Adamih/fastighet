import { m } from '#/paraglide/messages'

// Better Auth returns English messages; the UI shows its own, keyed on the error code.

const messages: Record<string, () => string> = {
  INVALID_EMAIL_OR_PASSWORD: m.auth_error_invalid_email_or_password,
  INVALID_EMAIL: m.auth_error_invalid_email,
  INVALID_PASSWORD: m.auth_error_invalid_password,
  PASSWORD_TOO_SHORT: m.auth_error_password_too_short,
  PASSWORD_TOO_LONG: m.auth_error_password_too_long,
  USER_ALREADY_EXISTS: m.auth_error_user_already_exists,
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: m.auth_error_user_already_exists,
  EMAIL_NOT_VERIFIED: m.auth_error_email_not_verified,
  INVALID_TOKEN: m.auth_error_invalid_token,
  TOO_MANY_REQUESTS: m.auth_error_too_many_requests,
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION:
    m.auth_error_user_is_already_a_member_of_this_organization,
  USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION:
    m.auth_error_user_is_already_invited_to_this_organization,
  YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION:
    m.auth_error_you_are_not_allowed_to_invite_users_to_this_organization,
  INVITATION_LIMIT_REACHED: m.auth_error_invitation_limit_reached,
  INVITATION_NOT_FOUND: m.auth_error_invitation_not_found,
  YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION:
    m.auth_error_you_are_not_the_recipient_of_the_invitation,
  EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION:
    m.auth_error_email_verification_required_before_accepting_or_rejecting_invitation,
  YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER: m.auth_error_you_are_not_allowed_to_update_this_member,
  YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER: m.auth_error_you_are_not_allowed_to_delete_this_member,
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER:
    m.auth_error_you_cannot_leave_the_organization_as_the_only_owner,
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER:
    m.auth_error_you_cannot_leave_the_organization_as_the_only_owner,
  MEMBER_NOT_FOUND: m.auth_error_member_not_found,
  INVITER_IS_NO_LONGER_A_MEMBER_OF_THE_ORGANIZATION:
    m.auth_error_inviter_is_no_longer_a_member_of_the_organization,
}

export function authErrorMessage(
  error: { code?: string; message?: string } | null | undefined,
  fallback: string = m.auth_error_fallback(),
): string {
  return (error?.code && messages[error.code]?.()) || fallback
}

/** Only same-site paths are allowed as post-login destinations, to avoid open redirects. */
export function safeRedirect(value: unknown): string | undefined {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : undefined
}
