import { describe, expect, it } from 'vitest'
import { MODULE_TABS, activeModule, isJournalPath } from '@/lib/shell/modules'

describe('MODULE_TABS', () => {
  it('has only the shipped modules, in order', () => {
    expect(MODULE_TABS.map((t) => [t.key, t.href('org1')])).toEqual([
      ['transactions', '/org1/transactions'],
      ['analytics', '/org1/analytics/cashflow'],
    ])
  })
})

describe('activeModule', () => {
  it.each([
    ['/org1/transactions', 'transactions'],
    ['/org1/analytics', 'analytics'],
    ['/org1/analytics/cashflow', 'analytics'],
    ['/org1/analytics/pl', 'analytics'],
  ])('%s -> %s', (path, key) => {
    expect(activeModule(path, 'org1')).toBe(key)
  })

  it.each([
    '/org1/settings/banks',
    '/org1/transactionsx',
    '/org1',
    '/org1/',
    '/org2/transactions',
    '/',
    '/analytics/org1',
  ])('%s -> null', (path) => {
    expect(activeModule(path, 'org1')).toBeNull()
  })
})

describe('isJournalPath', () => {
  it.each(['/org1/transactions', '/org1/transactions/'])('%s -> true', (path) => {
    expect(isJournalPath(path, 'org1')).toBe(true)
  })

  it.each([
    '/org1/analytics/cashflow',
    '/org1/settings/company',
    '/org1/transactionsx',
    '/org1/transactions/extra',
    '/org1',
    '/org2/transactions',
    '/',
  ])('%s -> false', (path) => {
    expect(isJournalPath(path, 'org1')).toBe(false)
  })
})
