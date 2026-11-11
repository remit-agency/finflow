import { describe, expect, it } from 'vitest'
import { MODULE_TABS, activeModule, isJournalPath } from '@/lib/shell/modules'

describe('MODULE_TABS', () => {
  it('has only the shipped modules, in order', () => {
    expect(MODULE_TABS.map((t) => [t.key, t.href('org1')])).toEqual([
      ['transactions', '/org1/transactions'],
      ['recurring', '/org1/recurring'],
      ['analytics', '/org1/analytics/cashflow'],
      ['invoices', '/org1/invoices'],
      ['calendar', '/org1/analytics/calendar'],
      ['rules', '/org1/rules'],
    ])
  })
})

describe('activeModule', () => {
  it.each([
    ['/org1/transactions', 'transactions'],
    ['/org1/recurring', 'recurring'],
    ['/org1/analytics', 'analytics'],
    ['/org1/analytics/cashflow', 'analytics'],
    ['/org1/analytics/pl', 'analytics'],
    ['/org1/analytics/balance/', 'analytics'],
    ['/org1/analytics/calendar', 'calendar'],
    ['/org1/analytics/calendar/', 'calendar'],
    ['/org1/invoices', 'invoices'],
    ['/org1/rules', 'rules'],
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
