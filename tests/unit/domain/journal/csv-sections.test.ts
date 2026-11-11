import { describe, expect, it } from 'vitest'
import { buildCsvSections } from '@/lib/domain/journal/csv'

describe('buildCsvSections', () => {
  it('several tables under their titles, an empty line between them, the cells and line ends of buildCsv', () => {
    expect(buildCsvSections([{ title: 'A', header: ['x', 'y'], rows: [['1', '2']] }, { title: 'B;C', header: ['z'], rows: [] }])).toBe('﻿A\r\nx;y\r\n1;2\r\n\r\n"B;C"\r\nz\r\n')
  })
})
