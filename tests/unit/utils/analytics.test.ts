import { describe, expect, it } from 'vitest'
import { formatDayLabel, formatMonthLabel } from '@/lib/utils/analytics'

describe('labels of the report buckets and columns (S12 builds the reports on the server; the labels stay here)', () => {
  it('a month is the first three letters of its name in the UI language; English writes the full year', () => {
    const months = (locale: 'uk' | 'pl' | 'en') => Array.from({ length: 12 }, (_, m) => formatMonthLabel(2026, m, locale))
    expect(months('uk')).toEqual(['Січ 26', 'Лют 26', 'Бер 26', 'Кві 26', 'Тра 26', 'Чер 26', 'Лип 26', 'Сер 26', 'Вер 26', 'Жов 26', 'Лис 26', 'Гру 26'])
    expect(months('pl')).toEqual(['Sty 26', 'Lut 26', 'Mar 26', 'Kwi 26', 'Maj 26', 'Cze 26', 'Lip 26', 'Sie 26', 'Wrz 26', 'Paź 26', 'Lis 26', 'Gru 26'])
    expect(months('en')).toEqual(['Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026', 'Oct 2026', 'Nov 2026', 'Dec 2026'])
  })

  it('a day is its number and the short month, lower case in Ukrainian and Polish', () => {
    const day = new Date(Date.UTC(2026, 9, 19))
    expect([formatDayLabel(day, 'uk'), formatDayLabel(day, 'pl'), formatDayLabel(day, 'en')]).toEqual(['19 жов', '19 paź', '19 Oct'])
  })
})
