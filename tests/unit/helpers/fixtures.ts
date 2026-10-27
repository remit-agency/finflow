import type { Account, Transaction } from '@/types'

/** An actual PLN income on 2026-10-20; override what the test cares about. */
export function makeTx(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1',
    orgId: 'org1',
    accountId: 'a1',
    type: 'income',
    status: 'actual',
    amount: 100,
    currency: 'PLN',
    date: new Date('2026-10-20T00:00:00Z'),
    accrual: { mode: 'date', date: '2026-10-20' },
    isRecurring: false,
    tags: [],
    fileUrls: [],
    ...over,
  }
}

/** A PLN bank account with a zero balance. */
export function makeAccount(over: Partial<Account> = {}): Account {
  return {
    id: 'a1',
    orgId: 'org1',
    name: 'Main',
    type: 'bank',
    balance: 0,
    opening: 0,
    currency: 'PLN',
    color: '#00c896',
    ...over,
  }
}
