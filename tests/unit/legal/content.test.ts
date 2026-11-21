import { describe, expect, it } from 'vitest'
import { OPERATOR } from '@/content/legal/operator'
import { OUTLINE, fillOperator, getLegalContent } from '@/content/legal'
import { OPERATOR_TOKENS, type LegalBlock, type LegalContent } from '@/lib/legal/content-types'
import { LOCALES } from '@/lib/i18n/config'
import { PUBLIC_LEGAL_DOCS } from '@/lib/legal/versions'

// extended in Task 7/8
const DOCS = PUBLIC_LEGAL_DOCS.filter((d) => d === 'cookies')

function blockTexts(block: LegalBlock): string[] {
  switch (block.kind) {
    case 'p':
      return [block.text]
    case 'ul':
      return block.items
    case 'table':
      return [...block.head, ...block.rows.flat()]
    case 'processors':
      return []
  }
}

function allTexts(content: LegalContent): string[] {
  return [content.title, content.intro, ...content.sections.flatMap((s) => [s.title, ...s.blocks.flatMap(blockTexts)])]
}

describe.each(DOCS)('legal content: %s', (doc) => {
  describe.each(LOCALES)('%s', (locale) => {
    const content = getLegalContent(doc, locale)

    it('has the sections of the outline, in order', () => {
      expect(content.sections.map((s) => s.id)).toEqual(OUTLINE[doc])
    })

    it('has a title, an intro and no empty section', () => {
      expect(content.title).not.toBe('')
      expect(content.intro).not.toBe('')
      for (const s of content.sections) {
        expect(s.title, s.id).not.toBe('')
        expect(s.blocks.length, s.id).toBeGreaterThan(0)
      }
    })

    it('uses only known operator tokens', () => {
      const known: readonly string[] = OPERATOR_TOKENS
      for (const text of allTexts(content)) {
        for (const [, token] of text.matchAll(/\{(\w+)\}/g)) expect(known, `${token} in "${text}"`).toContain(token)
      }
    })

    it('leaves no raw token once the operator is filled in', () => {
      for (const text of allTexts(content)) expect(fillOperator(text, OPERATOR), text).not.toContain('{')
    })

    it('has table rows as wide as the table head', () => {
      for (const s of content.sections)
        for (const b of s.blocks) if (b.kind === 'table') for (const row of b.rows) expect(row).toHaveLength(b.head.length)
    })
  })
})

describe('fillOperator', () => {
  const filled = { ...OPERATOR, supportEmail: 'pomoc@example.pl' }
  it('replaces a known token', () => {
    expect(fillOperator('Write to {supportEmail}.', filled)).toBe('Write to pomoc@example.pl.')
  })
  it('shows a placeholder for an empty operator field, never the raw token', () => {
    expect(fillOperator('{nip}', OPERATOR)).toBe('[…]')
  })
  it('leaves an unknown or non-token key alone', () => {
    expect(fillOperator('{processors} {nope}', OPERATOR)).toBe('{processors} {nope}')
  })
})
