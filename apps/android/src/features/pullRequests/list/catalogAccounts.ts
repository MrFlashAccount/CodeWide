import type { AccountState } from "../../../data/forgeContract";

/**
 * Whether the catalog reads the account: it is connected and not excluded
 * from the catalog. An excluded account is hidden everywhere in the catalog UI.
 */
export function isCatalogAccount(account: AccountState): boolean {
  return account.state === "connected" && account.catalogEnabled !== false;
}

/** Distinct logins of the catalog accounts, in account order. */
export function catalogAccountLogins(accounts: readonly AccountState[]): readonly string[] {
  const logins = new Set<string>();
  for (const account of accounts) {
    if (isCatalogAccount(account)) {
      logins.add(account.login);
    }
  }
  return [...logins];
}
