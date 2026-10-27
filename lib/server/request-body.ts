import 'server-only'
import { HttpError } from '@/lib/server/http-error'

/**
 * Reads a JSON request body: 413 over `maxBytes` (declared or actual), 415 unless application/json,
 * 400 `invalid_body` for text that is not JSON.
 */
export async function readJsonBody(req: Request, maxBytes: number): Promise<unknown> {
  const declared = req.headers.get('content-length')
  if (declared !== null && Number(declared) > maxBytes) throw new HttpError(413, 'payload too large')
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported media type')
  }
  const text = await req.text()
  if (text.length > maxBytes) throw new HttpError(413, 'payload too large')
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, 'invalid_body')
  }
}
