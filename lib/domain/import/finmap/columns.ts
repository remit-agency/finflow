import { foldHeader } from './fold'
import type { ColumnKey } from './types'

const HEADERS: Record<ColumnKey, string> = {
  paymentDate: 'dataplatnosci', bookingDate: 'datazaksiegowania', periodFrom: 'okresksiegowaniadataod', periodTo: 'okresksiegowaniadatado',
  amountAccount: 'kwotawwaluciekonta', amountCompany: 'kwotawwaluciefirmy', from: 'zkonta', to: 'nakonto',
  category: 'kategoria', subcategory: 'podkategoria', counterparty: 'kontrahent', subcounterparty: 'podkontrahent',
  project: 'projekt', subproject: 'podprojekt', tags: 'tagi', comment: 'komentarz',
}
const REQUIRED: readonly ColumnKey[] = ['paymentDate', 'amountAccount', 'from', 'to']

export type ColumnMap = Partial<Record<ColumnKey, number>>

/** Finds the export's columns in its header row. `missing` lists the required ones that are absent. */
export function matchColumns(header: readonly string[]): { map: ColumnMap; missing: ColumnKey[] } {
  const folded = header.map(foldHeader)
  const map: ColumnMap = {}
  for (const key of Object.keys(HEADERS) as ColumnKey[]) {
    const i = folded.indexOf(HEADERS[key])
    if (i !== -1) map[key] = i
  }
  return { map, missing: REQUIRED.filter((k) => map[k] === undefined) }
}
