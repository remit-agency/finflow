import { describe, expect, it } from 'vitest'
import { parseRuleInput } from '@/lib/domain/rules/input'
import { MAX_CONDITIONS, MAX_VALUES, RULE_NAME_MAX, VALUE_MAX } from '@/lib/domain/rules/types'
import { readJsonBody } from '@/lib/server/request-body'
import { RULE_BODY_MAX_BYTES } from '@/lib/server/rules/http'

/** A word of the largest allowed length: 80 Cyrillic characters, 2 bytes each in UTF-8. */
const word = (): string => 'Я'.repeat(VALUE_MAX)

/** The largest rule a request may carry: 10 conditions of 20 words of 80 characters, a 100-character name. */
function maxRuleBody(): string {
  return JSON.stringify({
    name: 'Я'.repeat(RULE_NAME_MAX),
    type: 'expense',
    active: true,
    conditions: Array.from({ length: MAX_CONDITIONS }, () => ({
      kind: 'text',
      op: 'contains',
      values: Array.from({ length: MAX_VALUES }, () => word()),
    })),
    actions: { categoryId: 'k-fuel' },
  })
}

describe('the rules request body limit', () => {
  it('is 64 KB, and the largest Cyrillic rule fits in it (it is over the old 32 KB)', () => {
    expect(RULE_BODY_MAX_BYTES).toBe(64 * 1024)
    const body = maxRuleBody()
    expect(new TextEncoder().encode(body).length).toBeGreaterThan(32 * 1024)
    expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(RULE_BODY_MAX_BYTES)
  })

  it('reads the largest rule body with its declared length and it validates', async () => {
    expect(RULE_BODY_MAX_BYTES).toBe(64 * 1024)
    const body = maxRuleBody()
    const req = new Request('http://localhost/api/orgs/org1/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(new TextEncoder().encode(body).length) },
      body,
    })
    const input = parseRuleInput(await readJsonBody(req, RULE_BODY_MAX_BYTES))
    expect(input.conditions).toHaveLength(MAX_CONDITIONS)
    expect(input.conditions.every((c) => c.kind === 'text' && c.values.length === MAX_VALUES)).toBe(true)
  })
})
