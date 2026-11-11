import { isAppPath } from '@/lib/auth/paths'
import { getAdmin } from '@/lib/server/firebase-admin'
import { orgRef } from '@/lib/server/ledger/paths'

export const runtime = 'nodejs'

// The home address of a company (S12) opens «Гроші зараз» at /<org>/dashboard. A route handler, not a page: the status must be
// explicit. A page's notFound() after the Firestore read answered 200 in `next dev` (measured by the S12 Task 13 probe).
// `isAppPath` accepts every single segment (`/test-login` too), so the organization itself must exist before the redirect.
// A non-company gets a plain 404, as it had before this address existed.
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  const dashboard = `/${orgSlug}/dashboard`
  const notFound = () => new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  // A reserved Firestore id (`__x__`) cannot be a company.
  if (!isAppPath(dashboard) || /^__.*__$/.test(orgSlug)) return notFound()
  const exists = (await orgRef(getAdmin().db, orgSlug).get()).exists
  if (!exists) return notFound()
  return Response.redirect(new URL(dashboard, request.url), 307)
}
