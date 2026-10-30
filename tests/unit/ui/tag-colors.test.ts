import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TAG_COLORS } from '@/lib/domain/tags/types'
import { TAG_DOT_CLASS } from '@/lib/ui/tag-colors'

// The palette keys are data; their dots are the `--color-tag-*` tokens of app/globals.css (no hex in the components).
const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')

describe('TAG_DOT_CLASS', () => {
  it.each(TAG_COLORS)('%s has a dot utility and a --color-tag-* token', (color) => {
    expect(TAG_DOT_CLASS[color]).toBe(`bg-tag-${color}`)
    expect(css).toMatch(new RegExp(`--color-tag-${color}:\\s*#[0-9a-f]{6};`))
  })
})
