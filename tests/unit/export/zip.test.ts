import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { buildExportZip } from '@/lib/domain/export/zip'
import { exportZipFileName } from '@/lib/utils/download'

describe('buildExportZip', () => {
  it('round-trips names and text, also non-ASCII', () => {
    const files = {
      'transactions.json': '[{"id":"a","amountMinor":12345}]',
      'me.json': '{"displayName":"Zażółć gęślą jaźń"}',
      'README.txt': 'Дані компанії: Київ, їжак, ґанок',
    }
    const out = unzipSync(buildExportZip(files))
    expect(Object.keys(out).sort()).toEqual(['README.txt', 'me.json', 'transactions.json'])
    for (const [name, text] of Object.entries(files)) expect(strFromU8(out[name])).toBe(text)
  })

  it('zips no files into a readable archive', () => {
    expect(Object.keys(unzipSync(buildExportZip({})))).toEqual([])
  })
})

describe('exportZipFileName', () => {
  it('lowercases, collapses non-alphanumerics to one dash and trims', () => {
    expect(exportZipFileName('Acme Sp. z o.o.', '2026-11-21')).toBe('finflow-acme-sp-z-o-o-2026-11-21.zip')
    expect(exportZipFileName('  --Acme!!  ', '2026-11-21')).toBe('finflow-acme-2026-11-21.zip')
  })

  it('falls back to company when no letter or digit is left', () => {
    expect(exportZipFileName('Київ', '2026-11-21')).toBe('finflow-company-2026-11-21.zip')
    expect(exportZipFileName('...', '2026-11-21')).toBe('finflow-company-2026-11-21.zip')
  })
})
