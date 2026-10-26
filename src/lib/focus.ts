import { defaultParseSearch } from '@tanstack/react-router'

// The company in focus travels in the URL (`?company=<id>`, kept across links by the `_app`
// route) and reaches server functions as a header, set by the function middleware in
// `src/start.ts`. During SSR, server functions read it from the page's URL instead. Without it,
// the request is about the user's own company. `runApp` checks it against the user's scope on
// every request, so neither the URL nor the header grants anything by itself.

export const COMPANY_HEADER = 'x-fastighet-company'

/** The company id in a URL search string, parsed the way the router stringifies it. */
export function companyFromSearch(search: string): string | null {
  const company = (defaultParseSearch(search) as Record<string, unknown>).company
  return typeof company === 'string' && company !== '' ? company : null
}
