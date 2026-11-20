import 'server-only'
import type { ImportDeps } from './deps'
import { importsCol } from './paths'
import { importView, parseImportDoc, type ImportView } from './types'

/** The newest imports of a company that the list returns (S14). */
const LIST_LIMIT = 50

/** The company's imports, newest first. A document that does not parse is skipped, not listed as an import. */
export async function listImports(deps: ImportDeps, orgId: string): Promise<ImportView[]> {
  const snap = await importsCol(deps.db, orgId).orderBy('createdAt', 'desc').limit(LIST_LIMIT).get()
  const views: ImportView[] = []
  for (const d of snap.docs) {
    const doc = parseImportDoc(d.data())
    if (doc !== null) views.push(importView(d.id, doc))
  }
  return views
}
