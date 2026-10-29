import { describe, expect, it } from 'vitest'
import { enterAction, highlightedRow, type PickerRow } from '@/lib/domain/counterparties/picker'
import type { Counterparty } from '@/lib/domain/counterparties/types'

const c = (id: string, name: string, extra: Partial<Counterparty> = {}): Counterparty => ({ id, name, ibans: [], archived: false, ...extra })

const ALFA = c('alfa', 'Alfa')
const ZUS = c('zus', 'ZUS', { kind: 'zus' })

/** The rows the picker shows: «none», the counterparties, then «add». */
const rows = (...list: Counterparty[]): PickerRow[] => [
  { kind: 'none' },
  ...list.map((counterparty): PickerRow => ({ kind: 'item', counterparty })),
  { kind: 'create' },
]

describe('highlightedRow', () => {
  it('starts on the chosen counterparty, so Enter right after Tab keeps it', () => {
    expect(highlightedRow(rows(ALFA, ZUS), 'zus', '', null)).toBe(2)
  })

  it('follows the list while it loads: «none» first, the chosen counterparty once it is there', () => {
    expect(highlightedRow(rows(), 'alfa', '', null)).toBe(0)
    expect(highlightedRow(rows(ALFA, ZUS), 'alfa', '', null)).toBe(1)
  })

  it('is «none» when nothing is chosen', () => {
    expect(highlightedRow(rows(ALFA), null, '', null)).toBe(0)
  })

  it('is the first match while a query is typed, or «add» when nothing matches', () => {
    expect(highlightedRow(rows(ZUS), 'alfa', 'zu', null)).toBe(1)
    expect(highlightedRow(rows(), 'alfa', 'xyz', null)).toBe(1)
    expect(highlightedRow([{ kind: 'none' }], 'alfa', 'xyz', null)).toBe(0)
  })

  it('stays where the person moved it, within the list a narrower query leaves', () => {
    expect(highlightedRow(rows(ALFA, ZUS), 'alfa', '', 0)).toBe(0)
    expect(highlightedRow(rows(ALFA), null, 'a', 3)).toBe(2)
  })
})

describe('enterAction', () => {
  it('chooses the highlighted counterparty', () => {
    expect(enterAction(rows(ALFA, ZUS), 'alfa', '', null)).toEqual({ kind: 'choose', row: { kind: 'item', counterparty: ALFA } })
    expect(enterAction(rows(ALFA, ZUS), 'alfa', '', 2)).toEqual({ kind: 'choose', row: { kind: 'item', counterparty: ZUS } })
  })

  it('keeps a chosen counterparty that is not in the list yet instead of clearing it', () => {
    expect(enterAction(rows(), 'alfa', '', null)).toEqual({ kind: 'keep' })
  })

  it('keeps a chosen counterparty the list leaves out (archived)', () => {
    expect(enterAction(rows(ZUS), 'alfa', '', null)).toEqual({ kind: 'keep' })
  })

  it('clears the choice when the person moved the highlight to «none»', () => {
    expect(enterAction(rows(ALFA), 'alfa', '', 0)).toEqual({ kind: 'choose', row: { kind: 'none' } })
    expect(enterAction(rows(), 'alfa', '', 0)).toEqual({ kind: 'choose', row: { kind: 'none' } })
  })

  it('chooses «none» when nothing is chosen', () => {
    expect(enterAction(rows(ALFA), null, '', null)).toEqual({ kind: 'choose', row: { kind: 'none' } })
  })

  it('does nothing on «none» while a query is typed', () => {
    expect(enterAction([{ kind: 'none' }], 'alfa', 'xyz', null)).toEqual({ kind: 'ignore' })
    expect(enterAction(rows(ALFA), 'alfa', 'al', 0)).toEqual({ kind: 'ignore' })
  })

  it('opens «add» with what was typed', () => {
    expect(enterAction(rows(), null, 'Nowa', null)).toEqual({ kind: 'choose', row: { kind: 'create' } })
  })
})
