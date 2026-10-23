// Better Auth returns English messages; the UI shows Swedish ones keyed on the error code.

const messages: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Fel e-postadress eller lösenord',
  INVALID_EMAIL: 'Ogiltig e-postadress',
  INVALID_PASSWORD: 'Fel lösenord',
  PASSWORD_TOO_SHORT: 'Lösenordet måste vara minst 8 tecken',
  PASSWORD_TOO_LONG: 'Lösenordet är för långt',
  USER_ALREADY_EXISTS: 'Det finns redan ett konto med den e-postadressen',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Det finns redan ett konto med den e-postadressen',
  EMAIL_NOT_VERIFIED:
    'Du behöver bekräfta din e-postadress. Vi har skickat en ny länk till din inkorg.',
  INVALID_TOKEN: 'Länken är ogiltig eller har gått ut',
  TOO_MANY_REQUESTS: 'För många försök. Vänta en stund och försök igen.',
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: 'Personen är redan med i företaget',
  USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION: 'Personen har redan en väntande inbjudan',
  YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION:
    'Du har inte behörighet att bjuda in användare',
  INVITATION_LIMIT_REACHED: 'Gränsen för antal inbjudningar är nådd',
  INVITATION_NOT_FOUND: 'Inbjudan finns inte, har gått ut eller har redan använts',
  YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION:
    'Inbjudan gäller en annan e-postadress än den du är inloggad med',
  EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION:
    'Bekräfta din e-postadress innan du svarar på inbjudan',
  YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER: 'Du har inte behörighet att ändra den här användaren',
  YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER:
    'Du har inte behörighet att ta bort den här användaren',
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER: 'Företaget måste ha minst en ägare',
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER: 'Företaget måste ha minst en ägare',
  MEMBER_NOT_FOUND: 'Användaren finns inte längre i företaget',
  INVITER_IS_NO_LONGER_A_MEMBER_OF_THE_ORGANIZATION:
    'Personen som bjöd in dig är inte längre med i företaget',
}

export function authErrorMessage(
  error: { code?: string; message?: string } | null | undefined,
  fallback = 'Något gick fel. Försök igen.',
): string {
  return (error?.code && messages[error.code]) || fallback
}

/** Only same-site paths are allowed as post-login destinations, to avoid open redirects. */
export function safeRedirect(value: unknown): string | undefined {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : undefined
}
