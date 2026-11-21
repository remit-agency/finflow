import type { PublicLegalDoc } from '@/lib/legal/versions'

export const OUTLINE: Readonly<Record<PublicLegalDoc, readonly string[]>> = {
  terms: ['definitions', 'service', 'account', 'obligations', 'banking', 'liability', 'ip', 'termination', 'changes', 'law', 'dpa'],
  privacy: ['controller', 'purposes', 'data', 'recipients', 'transfers', 'retention', 'rights', 'cookies', 'automated'],
  cookies: ['what', 'list', 'storage', 'none'],
}
