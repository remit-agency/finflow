/**
 * The accounts a bank is linked to, from the bank status the server gives an owner (`accounts`, every bank account, the
 * disconnected ones too: the server refuses those as targets as well). Null when the browser cannot see them: a role
 * without the list, or no answer yet. Null means unknown, never «not linked».
 */
export function bankLinkedIds(accounts: readonly { accountId: string }[] | undefined): ReadonlySet<string> | null {
  return accounts === undefined ? null : new Set(accounts.map((a) => a.accountId))
}

/**
 * The accounts «Зробити переказом» may offer as the other side: the same currency as the source, never the source itself,
 * and not an account a bank is linked to when `linked` is known. The server refuses a linked account anyway (`not_eligible`);
 * hiding it saves the refusal. Order is kept.
 */
export function convertTargets<A extends { id: string; currency: string }>(
  accounts: readonly A[],
  source: { id: string; currency: string },
  linked: ReadonlySet<string> | null,
): A[] {
  return accounts.filter((a) => a.id !== source.id && a.currency === source.currency && !(linked?.has(a.id) ?? false))
}
