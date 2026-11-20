// Pure report of `check:mt940` (no I/O): what one decoded statement file looks like after parsing. The script prints these
// lines for the owner's real files; they carry no full account number and no text beyond the first 20 characters.
import type { ParseResult } from '@/lib/domain/import/types'

export interface FileCheck {
  name: string
  encoding: string
  result: ParseResult
}

/** Only the last 4 characters of an account number are shown. */
export function maskAccount(value: string | null): string {
  return value === null ? 'none' : `…${value.slice(-4)}`
}

/** The first `max` characters of a text, with a mark when it was cut; a missing text is an en dash. */
export function shortText(value: string | null, max = 20): string {
  if (value === null) return '–'
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function money(minor: number, type: 'income' | 'expense'): string {
  const sign = type === 'expense' ? '-' : ''
  return `${sign}${(Math.abs(minor) / 100).toFixed(2)}`
}

/** The report of one file as lines. Issues show their code and line; the first three operations show their texts cut to 20 characters. */
export function reportLines(check: FileCheck): string[] {
  const { statements, issues } = check.result
  const operations = statements.flatMap((s) => s.operations)
  const withoutCounterparty = operations.filter((op) => op.counterpartyName === null).length
  const withoutRemittance = operations.filter((op) => op.remittance === null).length

  const lines = [`== ${check.name} · encoding: ${check.encoding} · statements: ${statements.length} · operations: ${operations.length}`]
  lines.push(issues.length === 0 ? '  issues: none' : `  issues: ${issues.map((i) => `${i.code} line ${i.line}`).join(', ')}`)
  for (const statement of statements) {
    lines.push(`  statement ${statement.index + 1} · account ${maskAccount(statement.source)} · reconciliation: ${statement.reconciliation ?? 'null'}`)
  }
  lines.push(`  without counterparty: ${withoutCounterparty} · without remittance: ${withoutRemittance}`)
  for (const op of operations.slice(0, 3)) {
    lines.push(
      `  ${op.day} ${money(op.amountMinor, op.type)} · counterparty: ${shortText(op.counterpartyName)} · remittance: ${shortText(op.remittance)}`,
    )
  }
  return lines
}
