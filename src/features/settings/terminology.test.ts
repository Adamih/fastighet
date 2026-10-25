import { expect, test } from 'bun:test'
import { companyTerms, documentTerms } from './terminology'

test('a BRF calls its people members', () => {
  expect(companyTerms('landlord').parties).toBe('Hyresgäster')
  expect(companyTerms('brf').parties).toBe('Medlemmar')
})

test('documents are named by what they bill', () => {
  expect(documentTerms('lease')).toMatchObject({ invoiceTitle: 'Hyresavi', charge: 'Hyra' })
  expect(documentTerms('tenant_ownership')).toMatchObject({
    invoiceTitle: 'Avgiftsavi',
    charge: 'Avgift',
  })
})
