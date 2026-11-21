import type {
  AccountState,
  DisconnectMode,
  ForgeAccountsSnapshot,
  ForgeProvider,
} from "../../../data/forgeContract";

const SOURCES: Readonly<Record<AccountState["credentialSource"], string>> = {
  arcToken: "arc token on the host",
  environment: "environment token on the host",
  ghCli: "gh login on the host",
  savedToken: "saved token on the companion",
};

/** `gh login on the host · repo, read:org` — source and scopes, never a token. */
function accountCredentialLine(account: AccountState): string {
  const scopes =
    account.scopes === null || account.scopes.length === 0 ? "" : ` · ${account.scopes.join(", ")}`;
  return `${SOURCES[account.credentialSource]}${scopes}`;
}

/**
 * Supporting line of an account row: where its credential comes from while it
 * works, otherwise what is wrong and the Companion's short reason.
 */
export function accountDescription(account: AccountState): string {
  if (account.state === "expired") {
    return `Expired · ${account.hint}`;
  }
  if (account.state === "error") {
    return `Error · ${account.reason}`;
  }
  return `${account.host} · ${accountCredentialLine(account)}`;
}

/**
 * Removal modes this account offers, default first: a saved token is always
 * forgotten; otherwise `unlink` leads and `logoutHost` is offered only when the
 * plugin declares it.
 */
export function disconnectModes(
  account: AccountState,
  provider: ForgeProvider | undefined,
): readonly DisconnectMode[] {
  const declared = new Set(provider?.authMethods.flatMap((method) => method.disconnectModes) ?? []);
  if (account.credentialSource === "savedToken") {
    return ["forgetToken"];
  }
  return declared.has("logoutHost") ? ["unlink", "logoutHost"] : ["unlink"];
}

/** Overflow-menu copy of one removal mode. */
export const DISCONNECT_LABELS: Readonly<Record<DisconnectMode, string>> = {
  forgetToken: "Remove account and token",
  logoutHost: "Log out on host",
  unlink: "Remove account",
};

/** Whether the provider's plugin can serve sign-in now; an older Companion does not say. */
export function providerInstalled(provider: ForgeProvider): boolean {
  return provider.installation.state === "installed" || provider.installation.state === "unknown";
}

/** Onboarding shows until some enabled provider has a linked account, whatever its state. */
export function hasLinkedAccount(snapshot: ForgeAccountsSnapshot): boolean {
  return snapshot.accounts.some((account) =>
    snapshot.providers.some(
      (provider) => provider.enabled && provider.pluginId === account.pluginId,
    ),
  );
}
