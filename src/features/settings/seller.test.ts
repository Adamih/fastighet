import { describe, expect, test } from 'bun:test'
import { type SettingsDraft, sellerDetails, settingsReadiness } from './seller'

const seller = {
  organizationName: 'Exempel Fastigheter AB',
  organizationNumber: '556677-8899',
  streetAddress: 'Kungsgatan 1',
  postalCode: '75321',
  city: 'Uppsala',
  email: 'hyra@exempel.test',
  phone: '018-12 34 56',
  fSkatt: true,
}

describe('sellerDetails', () => {
  test('prints name and address, ids and contact on separate lines', () => {
    expect(sellerDetails(seller, true)).toEqual([
      'Exempel Fastigheter AB, Kungsgatan 1, 75321 Uppsala',
      'Org.nr 556677-8899 · Momsreg.nr SE556677889901 · Godkänd för F-skatt',
      'hyra@exempel.test · 018-12 34 56',
    ])
  })

  test('leaves out the VAT number without VAT and skips empty lines', () => {
    expect(
      sellerDetails(
        { ...seller, organizationNumber: null, fSkatt: false, email: null, phone: null },
        false,
      ),
    ).toEqual(['Exempel Fastigheter AB, Kungsgatan 1, 75321 Uppsala'])
  })
})

describe('settingsReadiness', () => {
  const complete: SettingsDraft = {
    organizationNumber: '556677-8899',
    bankgiro: '5050-1055',
    streetAddress: 'Kungsgatan 1',
    postalCode: '75321',
    city: 'Uppsala',
    email: 'hyra@exempel.test',
  }

  test('everything filled in is ready', () => {
    expect(settingsReadiness(complete).every((i) => i.done)).toBe(true)
  })

  test('bankgiro comes first and must be valid', () => {
    const items = settingsReadiness({ ...complete, bankgiro: '1234' })
    expect(items[0]).toMatchObject({ key: 'bankgiro', done: false })
    expect(items.filter((i) => !i.done)).toHaveLength(1)
  })

  test('an address needs street, postal code and city', () => {
    const items = settingsReadiness({ ...complete, city: ' ', email: '' })
    expect(items.filter((i) => !i.done).map((i) => i.key)).toEqual(['address', 'email'])
  })
})
