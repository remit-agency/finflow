import 'server-only'
import type { JournalKey } from '@/lib/domain/journal/order'
import type { RuleInput, RulePatch } from '@/lib/domain/rules/input'
import { ledgerDeps } from '@/lib/server/ledger'
import { applyStep, checkStep, previewRule } from './apply'
import { listRules } from './read'
import { createRule, deleteRule, orderRules, updateRule } from './write'

/** The rules service bound to the production Firestore and clock. */
export const rules = {
  list: (orgId: string) => listRules(ledgerDeps().db, orgId),
  create: (orgId: string, uid: string, input: RuleInput) => createRule(ledgerDeps(), orgId, uid, input),
  update: (orgId: string, uid: string, ruleId: string, patch: RulePatch) => updateRule(ledgerDeps(), orgId, uid, ruleId, patch),
  remove: (orgId: string, uid: string, ruleId: string) => deleteRule(ledgerDeps(), orgId, uid, ruleId),
  order: (orgId: string, uid: string, ids: string[]) => orderRules(ledgerDeps(), orgId, uid, ids),
  preview: (orgId: string, input: RuleInput) => previewRule(ledgerDeps(), orgId, input),
  check: (orgId: string, cursor: JournalKey | null) => checkStep(ledgerDeps(), orgId, cursor),
  apply: (orgId: string, uid: string, cursor: JournalKey | null) => applyStep(ledgerDeps(), orgId, uid, cursor),
}
