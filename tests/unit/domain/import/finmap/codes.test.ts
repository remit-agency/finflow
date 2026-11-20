import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BATCH_REFUSAL_CODES, STOP_CODES, batchRefusalTextKey, stopTextKey } from '@/lib/domain/import/finmap/codes'

// The texts are read from the message files: a code without a text in a locale fails here.
const LOCALES = ['en', 'pl', 'uk'] as const
const finmapMessages = (locale: string): Record<string, unknown> => {
  const root = JSON.parse(readFileSync(join(process.cwd(), 'messages', `${locale}.json`), 'utf8')) as { import: { finmap: Record<string, unknown> } }
  return root.import.finmap
}
const textAt = (dict: Record<string, unknown>, key: string): unknown => key.split('.').reduce<unknown>((o, k) => (typeof o === 'object' && o !== null ? (o as Record<string, unknown>)[k] : undefined), dict)

describe('batch refusal and stop codes', () => {
  it('maps every code of the writer\'s refusal list to its own text key, and any other code to the generic one', () => {
    for (const code of Object.keys(BATCH_REFUSAL_CODES)) expect(batchRefusalTextKey(code)).toBe(`batchRefusal.${code}`)
    expect(batchRefusalTextKey('a_code_nobody_added')).toBe('batchRefusal.unknown')
  })

  it('maps the stop codes the screen knows to their text, and any other code to the generic one', () => {
    for (const code of Object.keys(STOP_CODES)) expect(stopTextKey(code)).toBe(`stopCode.${code}`)
    expect(stopTextKey('limit_reached')).toBe('stopCode.unknown')
  })

  it('has a text in every locale for each refusal code, each stop code and both generic texts', () => {
    const keys = [...Object.keys(BATCH_REFUSAL_CODES).map(batchRefusalTextKey), ...Object.keys(STOP_CODES).map(stopTextKey), batchRefusalTextKey('?'), stopTextKey('?')]
    for (const locale of LOCALES) {
      const dict = finmapMessages(locale)
      for (const key of keys) expect(typeof textAt(dict, key), `${locale}: ${key}`).toBe('string')
    }
  })

  it('keeps the code in the generic text, in parentheses', () => {
    for (const locale of LOCALES) {
      expect(String(textAt(finmapMessages(locale), 'batchRefusal.unknown'))).toContain('{code}')
      expect(String(textAt(finmapMessages(locale), 'stopCode.unknown'))).toContain('{code}')
    }
  })
})
