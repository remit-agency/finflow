'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { LazyAccountForm, LazyTransactionForm } from '@/components/forms/lazy'
import { getMembership } from '@/lib/firebase/members'
import { useAccounts } from '@/lib/hooks/useAccounts'
import { useAuth } from '@/lib/hooks/useAuth'
import { useCategories } from '@/lib/hooks/useCategories'
import { useOrg } from '@/lib/hooks/useOrg'
import { isValidOrgId } from '@/lib/shell/org-id'
import { can as canRole, type Action, type Role } from '@/lib/shell/permissions'
import { browserLocalStorage, createCollapsedStore } from '@/lib/shell/sidebar-store'
import { effectiveSelection } from '@/lib/utils/accounts'
import type { Account, Category, Organization, Transaction } from '@/types'

export type TransactionType = Transaction['type']

/** What the shell knows about the caller's access to the URL's company. */
export type Access =
  | { status: 'loading' }
  | { status: 'granted'; role: Role }
  | { status: 'denied' } // no membership document: not a member
  | { status: 'error' } // the membership could not be read (network, outage)

export interface ShellContextValue {
  /** The org id from the URL (`/[orgSlug]/...`). */
  orgId: string
  /** The loaded organization, only once it is the URL's org (null while loading or switching). */
  org: Organization | null
  /** Switch to another company: navigates to its journal and loads it (the switcher uses this). */
  chooseOrg: (orgId: string) => void
  /** The caller's access to the URL's company (read from their own membership document). */
  access: Access
  /** The caller's role, null until access is granted. */
  role: Role | null
  /** Whether the caller's role allows the action. False while access is not granted. */
  can: (action: Action) => boolean
  accounts: Account[]
  accountsLoading: boolean
  incomeCategories: Category[]
  expenseCategories: Category[]
  categoriesLoading: boolean
  /** The account chosen in the sidebar; the journal shows only its operations. */
  selectedAccountId: string | null
  selectAccount: (accountId: string | null) => void
  openTransactionForm: (type: TransactionType) => void
  /** Without an argument: a new account. With one: edit it. */
  openAccountForm: (account?: Account) => void
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  /** The phone accounts drawer (below 1024 px). */
  drawerOpen: boolean
  setDrawerOpen: (open: boolean) => void
}

const ShellContext = createContext<ShellContextValue | null>(null)

// Module level: the flag is per browser (persisted in localStorage, not synced live between open
// tabs) and survives client-side navigation between orgs.
const sidebarStore = createCollapsedStore(browserLocalStorage)

export function ShellProvider({ orgId, children }: { orgId: string; children: ReactNode }) {
  const tErrors = useTranslations('errors')
  const router = useRouter()
  const { org: loadedOrg, switchOrg } = useOrg()
  const { user } = useAuth()
  const uid = user?.uid ?? null
  // The id comes from the URL: a malformed one is "denied" without any Firestore call.
  const orgIdValid = isValidOrgId(orgId)

  // One membership read per (company, user). The result carries its key, so a result for the previous
  // company is never mistaken for the current one while a new read is in flight (no setState in the
  // effect body: the state is set from the promise callbacks only).
  const accessKey = uid && orgIdValid ? `${orgId}:${uid}` : null
  const [accessResult, setAccessResult] = useState<
    { key: string; role: Role | null } | { key: string; failed: true } | null
  >(null)
  useEffect(() => {
    if (!accessKey || !uid) return
    let cancelled = false
    getMembership(orgId, uid).then(
      (role) => {
        if (!cancelled) setAccessResult({ key: accessKey, role })
      },
      () => {
        if (!cancelled) setAccessResult({ key: accessKey, failed: true })
      },
    )
    return () => {
      cancelled = true
    }
  }, [accessKey, orgId, uid])

  const access: Access = !orgIdValid
    ? { status: 'denied' }
    : !accessKey || accessResult?.key !== accessKey
      ? { status: 'loading' }
      : 'failed' in accessResult
        ? { status: 'error' }
        : accessResult.role
          ? { status: 'granted', role: accessResult.role }
          : { status: 'denied' }
  const role = access.status === 'granted' ? access.role : null
  const dataOrgId = access.status === 'granted' ? orgId : null

  // The only accounts/categories subscription of the shell: pages read these from the context
  // (a second useCategories on a fresh org would seed the default categories twice). They start only
  // once access is granted, so a foreign URL never attaches listeners or seeds default categories.
  const { accounts, loading: accountsLoading } = useAccounts(dataOrgId)
  const { incomeCategories, expenseCategories, loading: categoriesLoading } = useCategories(dataOrgId, {
    seed: canRole(role, 'data.write'),
  })

  // A selection belongs to one org: it is ignored as soon as the URL points at another one.
  const [selection, setSelection] = useState<{ orgId: string; accountId: string | null }>({
    orgId,
    accountId: null,
  })
  // ...and to an account that still exists (it can be deleted in another tab).
  const selectedAccountId = effectiveSelection(selection.orgId === orgId ? selection.accountId : null, accounts)

  // The forms mount on open and unmount on close, so every opening starts from fresh form state.
  // Their code is loaded on the first open (next/dynamic), not with every app route.
  const [transactionFormType, setTransactionFormType] = useState<TransactionType | null>(null)
  const [accountForm, setAccountForm] = useState<{ account: Account | null } | null>(null)
  // The drawer remembers the path it was opened on and closes as soon as the route changes
  // (browser Back, a link inside it). Adjusting state during render is the React-documented way
  // to reset state when an input changes, and it needs no effect (no synchronous setState in one).
  const pathname = usePathname()
  const [drawerPath, setDrawerPath] = useState<string | null>(null)
  if (drawerPath !== null && drawerPath !== pathname) setDrawerPath(null)
  const drawerOpen = drawerPath !== null
  const setDrawerOpen = useCallback((open: boolean) => setDrawerPath(open ? pathname : null), [pathname])

  const sidebarCollapsed = useSyncExternalStore(
    sidebarStore.subscribe,
    sidebarStore.getSnapshot,
    sidebarStore.getServerSnapshot,
  )

  // OrgProvider restores the last org from localStorage, which can differ from the URL (a link
  // to another company, a second tab). Load the URL's org once per org id; the ref prevents a
  // loop when the user is not a member (switchOrg then keeps the old org).
  const requestedOrgId = useRef<string | null>(null)
  // Set by chooseOrg: the company the user just picked, while the route still shows this provider's
  // org. Without it this provider would see the newly loaded org differ from its URL org and switch
  // back to it, so the header and the sidebar would flicker back and forth.
  const chosenOrgId = useRef<string | null>(null)
  useEffect(() => {
    if (chosenOrgId.current !== null) {
      // The route reached the chosen org (nothing left to defer), otherwise a choice is in flight.
      if (chosenOrgId.current === orgId) chosenOrgId.current = null
      else return
    }
    if (!orgIdValid || !loadedOrg || loadedOrg.id === orgId || requestedOrgId.current === orgId) return
    requestedOrgId.current = orgId
    switchOrg(orgId).catch(() => toast.error(tErrors('switchOrg')))
  }, [loadedOrg, orgId, orgIdValid, switchOrg, tErrors])

  const chooseOrg = (id: string) => {
    if (id === orgId) return
    chosenOrgId.current = id
    requestedOrgId.current = id
    router.push(`/${id}/transactions`)
    switchOrg(id).catch(() => {
      chosenOrgId.current = null
      toast.error(tErrors('switchOrg'))
    })
  }

  const value: ShellContextValue = {
    orgId,
    org: loadedOrg && loadedOrg.id === orgId ? loadedOrg : null,
    chooseOrg,
    access,
    role,
    can: (action) => canRole(role, action),
    accounts,
    accountsLoading: access.status !== 'granted' || accountsLoading,
    incomeCategories,
    expenseCategories,
    categoriesLoading: access.status !== 'granted' || categoriesLoading,
    selectedAccountId,
    selectAccount: (accountId) => setSelection({ orgId, accountId }),
    openTransactionForm: (type) => setTransactionFormType(type),
    openAccountForm: (account) => setAccountForm({ account: account ?? null }),
    sidebarCollapsed,
    toggleSidebar: () => sidebarStore.set(!sidebarCollapsed),
    drawerOpen,
    setDrawerOpen,
  }

  return (
    <ShellContext.Provider value={value}>
      {children}
      {transactionFormType && (
        <LazyTransactionForm
          key={transactionFormType}
          orgId={orgId}
          accounts={accounts}
          incomeCategories={incomeCategories}
          expenseCategories={expenseCategories}
          defaultType={transactionFormType}
          open
          onClose={() => setTransactionFormType(null)}
        />
      )}
      {accountForm && (
        <LazyAccountForm
          key={accountForm.account?.id ?? 'new'}
          orgId={orgId}
          account={accountForm.account ?? undefined}
          open
          onClose={() => setAccountForm(null)}
        />
      )}
    </ShellContext.Provider>
  )
}

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext)
  if (!ctx) throw new Error('useShell must be used within ShellProvider')
  return ctx
}
