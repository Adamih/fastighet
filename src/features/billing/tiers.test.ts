import { expect, test } from 'bun:test'
import { companyKinds } from '#/features/settings/company-kinds'
import {
  cheapestTierFor,
  limitReached,
  plans,
  quantityOf,
  resolveTier,
  tierAllows,
  tiers,
} from './tiers'

const usage = { apartments: 12, units: 14, members: 2 }

test('each company type has a free, a middle and a top tier of its own', () => {
  for (const kind of companyKinds) {
    const own = plans[kind].tiers.map((id) => tiers[id])
    expect(own.map((t) => t.kind)).toEqual([kind, kind, kind])
    expect(own[0].price).toBeNull()
    expect(own[1].price).not.toBeNull()
  }
  // The top landlord and manager tiers are sold by sales; the rest through checkout.
  expect(
    Object.values(tiers)
      .filter((t) => t.sales)
      .map((t) => t.id),
  ).toEqual(['landlord_pro', 'manager_pro'])
})

test('features follow the comparison: a cell that is not "no" allows', () => {
  expect(tierAllows('brf_free', 'leases')).toBe(false)
  expect(tierAllows('brf_plus', 'leases')).toBe(true)
  expect(tierAllows('brf_plus', 'commercial')).toBe(true)
  expect(tierAllows('brf_free', 'bookkeeping')).toBe(false)
  // A free landlord lets homes, up to the backstop, but not premises.
  expect(tierAllows('landlord_free', 'leases')).toBe(true)
  expect(tierAllows('landlord_free', 'commercial')).toBe(false)
  expect(tierAllows('landlord', 'commercial')).toBe(true)
  // Managers manage clients on every tier; Alla bolag from Förvaltare.
  expect(tierAllows('manager_free', 'clients')).toBe(true)
  expect(tierAllows('manager_free', 'portfolio')).toBe(false)
  expect(tierAllows('manager', 'portfolio')).toBe(true)
  // Features of other company types are never allowed.
  expect(tierAllows('landlord_pro', 'clients')).toBe(false)
  expect(tierAllows('manager_pro', 'leases')).toBe(false)

  expect(cheapestTierFor('brf', 'leases')?.id).toBe('brf_plus')
  expect(cheapestTierFor('landlord', 'commercial')?.id).toBe('landlord')
  expect(cheapestTierFor('landlord', 'clients')).toBeNull()
})

test('the tier: ours if set, else a paying subscription, else free', () => {
  expect(resolveTier('brf', null, null)).toBe('brf_free')
  expect(resolveTier('brf', null, { plan: 'brf_plus', status: 'active' })).toBe('brf_plus')
  expect(resolveTier('brf', null, { plan: 'brf_plus', status: 'trialing' })).toBe('brf_plus')
  // Past due keeps the tier while Stripe retries; canceled or unpaid falls back.
  expect(resolveTier('brf', null, { plan: 'brf_plus', status: 'past_due' })).toBe('brf_plus')
  expect(resolveTier('brf', null, { plan: 'brf_plus', status: 'canceled' })).toBe('brf_free')
  expect(resolveTier('brf', null, { plan: 'brf_plus', status: 'unpaid' })).toBe('brf_free')
  expect(resolveTier('brf', 'brf_pro', { plan: 'brf_plus', status: 'active' })).toBe('brf_pro')
  // A tier of another type (the company changed type) doesn't apply.
  expect(resolveTier('landlord', 'brf_pro', { plan: 'brf_plus', status: 'active' })).toBe(
    'landlord_free',
  )
  expect(resolveTier('brf', 'nonsense', null)).toBe('brf_free')
})

test('what a tier counts, and its backstops', () => {
  expect(quantityOf('brf_free', usage)).toBeNull()
  expect(quantityOf('brf_plus', usage)).toBe(12)
  expect(quantityOf('landlord_pro', usage)).toBe(14)
  expect(quantityOf('manager', usage)).toBe(2)

  expect(limitReached('landlord_free', 'units', { ...usage, units: 4 })).toBe(false)
  expect(limitReached('landlord_free', 'units', { ...usage, units: 5 })).toBe(true)
  expect(limitReached('landlord', 'units', usage)).toBe(false)
  expect(limitReached('manager_free', 'members', usage)).toBe(true)
  expect(limitReached('manager', 'members', usage)).toBe(false)
})
