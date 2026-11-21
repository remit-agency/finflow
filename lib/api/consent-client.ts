import { LEGAL_VERSIONS } from '@/lib/legal/versions'
import type { ConsentSource } from '@/lib/legal/consent'

/** A failed POST /api/consent: `status` is the HTTP status (0 when the request never reached the server). */
export class ConsentApiError extends Error {
  constructor(public readonly status: number) {
    super(`consent request failed (${status})`)
    this.name = 'ConsentApiError'
  }
}

/** Records acceptance of the current versions of all documents. The session cookie is sent automatically (same-origin). */
export async function acceptLegalDocs(source: ConsentSource): Promise<void> {
  let res: Response
  try {
    res = await fetch('/api/consent', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docs: LEGAL_VERSIONS, source }),
    })
  } catch {
    throw new ConsentApiError(0)
  }
  if (!res.ok) throw new ConsentApiError(res.status)
}
