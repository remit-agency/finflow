import { parseExportRequest } from '@/lib/domain/reports/query'
import { LOCALE_COOKIE } from '@/lib/i18n/config'
import { resolveLocale } from '@/lib/i18n/negotiate'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { reports } from '@/lib/server/reports'
import { toReportHttpError } from '@/lib/server/reports/http'
import { readCookie } from '@/lib/server/session-cookie'

export const runtime = 'nodejs'
// The file is built from the same report: the same reads, then a few hundred cells.
export const maxDuration = 60

type Ctx = { params: Promise<{ orgId: string }> }

// GET /api/orgs/{orgId}/reports/export?report=cashflow|pl&format=csv|xlsx&from=&to=&<filters>  (owner, accountant, viewer) -> the file
// The words follow the language of the app (the NEXT_LOCALE cookie, else Accept-Language, else Polish), as the pages do.
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant', 'viewer'])
    const { kind, format, query } = parseExportRequest(new URL(req.url).searchParams)
    const locale = resolveLocale({ cookie: readCookie(req.headers, LOCALE_COOKIE), acceptLanguage: req.headers.get('accept-language') })
    const file = await reports.exportFile(orgId, kind, format, query, locale)
    return new Response(file.body, {
      headers: { 'Content-Type': file.contentType, 'Content-Disposition': `attachment; filename="${file.filename}"`, 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    return errorResponse(toReportHttpError(e))
  }
}
