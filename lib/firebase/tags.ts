import { collection, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import { parseTag } from '@/lib/domain/tags/doc'
import { sortTags } from '@/lib/domain/tags/search'
import type { Tag } from '@/lib/domain/tags/types'
import { db } from './firebase'

/** Tags are written by the server only (lib/api/tags-client.ts); the browser reads them here, live, in name order. */
export function getTags(orgId: string, callback: (tags: Tag[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, 'organizations', orgId, 'tags'),
    (snap) => {
      const list: Tag[] = []
      let skipped = 0
      for (const d of snap.docs) {
        const tag = parseTag(d.id, d.data())
        if (tag) list.push(tag)
        else skipped++
      }
      if (skipped > 0) console.warn(`tags: skipped ${skipped} unreadable document(s) in ${orgId}`)
      callback(sortTags(list))
    },
    (error) => {
      console.warn(`tags: cannot read ${orgId} (${error.code})`)
      callback([])
    },
  )
}
