import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CounterpartyError } from '@/lib/domain/counterparties/errors'
import { parseWhitelistBody } from '@/lib/domain/counterparties/whitelist'

const fixture = (name: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), 'tests/fixtures/whitelist', name), 'utf8'))

describe('parseWhitelistBody', () => {
  it('reads a VAT payer: name, address, status and only the valid account numbers', () => {
    expect(parseWhitelistBody(fixture('found-active.json'))).toEqual({
      found: true,
      subject: {
        name: 'ORLEN SPÓŁKA AKCYJNA',
        address: 'CHEMIKÓW 7, 09-411 PŁOCK',
        vatStatus: 'active',
        ibans: ['61109010140000071219812874'],
      },
    })
  })

  it('prefers the working address and maps Zwolniony to exempt', () => {
    const result = parseWhitelistBody(fixture('found-exempt.json'))
    expect(result).toEqual({
      found: true,
      subject: { name: 'JAN KOWALSKI USŁUGI', address: 'ul. Robocza 2, 00-002 Warszawa', vatStatus: 'exempt', ibans: [] },
    })
  })

  it('answers found:false for an unknown NIP', () => {
    expect(parseWhitelistBody(fixture('not-found.json'))).toEqual({ found: false })
  })

  it('maps Niezarejestrowany to unregistered', () => {
    const body = { result: { subject: { name: 'A', statusVat: 'Niezarejestrowany', accountNumbers: [] } } }
    expect(parseWhitelistBody(body)).toEqual({ found: true, subject: { name: 'A', vatStatus: 'unregistered', ibans: [] } })
  })

  it.each([
    ['unknown VAT status', fixture('unknown-status.json')],
    ['no result', {}],
    ['result not an object', { result: 5 }],
    ['subject without a name', { result: { subject: { statusVat: 'Czynny', accountNumbers: [] } } }],
    ['accountNumbers not an array', { result: { subject: { name: 'A', statusVat: 'Czynny', accountNumbers: 'x' } } }],
    ['not an object', 'text'],
  ])('throws lookup_unavailable for %s', (_label, body) => {
    expect(() => parseWhitelistBody(body)).toThrowError(CounterpartyError)
    try {
      parseWhitelistBody(body)
    } catch (e) {
      expect((e as CounterpartyError).code).toBe('lookup_unavailable')
    }
  })
})
