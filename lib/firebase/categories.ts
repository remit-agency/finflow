import {
  collection,
  doc,
  onSnapshot,
  addDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from './firebase'
import { buildDefaultCategories, type DefaultCategoryNames } from './default-categories'
import type { Category } from '@/types'

function categoriesRef(orgId: string) {
  return collection(db, 'organizations', orgId, 'categories')
}

// Idempotent: the check below is only an optimisation. Every default has a deterministic document
// id (buildDefaultCategories), so two concurrent seeds (StrictMode double effects, two tabs) both
// see an empty collection but write the same documents instead of adding duplicates.
export async function seedDefaultCategories(orgId: string, names: DefaultCategoryNames): Promise<void> {
  const snap = await getDocs(categoriesRef(orgId))
  if (!snap.empty) return

  await Promise.all(
    buildDefaultCategories(names).map(({ id, ...cat }) =>
      setDoc(doc(categoriesRef(orgId), id), {
        ...cat,
        orgId,
        createdAt: serverTimestamp(),
      })
    )
  )
}

export function getCategories(
  orgId: string,
  callback: (categories: Category[]) => void
): Unsubscribe {
  return onSnapshot(categoriesRef(orgId), (snap) => {
    const categories: Category[] = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<Category, 'id'>),
    }))
    callback(categories)
  })
}

export async function createCategory(
  orgId: string,
  data: Omit<Category, 'id' | 'orgId'>
): Promise<string> {
  const ref = await addDoc(categoriesRef(orgId), {
    ...data,
    orgId,
    createdAt: serverTimestamp(),
  })
  return ref.id
}
