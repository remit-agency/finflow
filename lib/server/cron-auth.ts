import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * True when the Authorization header is exactly "Bearer <secret>". Both sides are hashed first, so the comparison
 * takes the same time whatever is given and the inputs may differ in length.
 */
export function bearerMatches(header: string | null, secret: string): boolean {
  const given = createHash('sha256').update(header ?? '').digest()
  const expected = createHash('sha256').update(`Bearer ${secret}`).digest()
  return timingSafeEqual(given, expected)
}
