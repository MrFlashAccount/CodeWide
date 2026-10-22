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
export function accountCredentialLine(account: AccountState): string {
  const scopes =
    account.scopes === null || account.scopes.length === 0 ? "" : ` · ${account.scopes.join(", ")}`;
  return `${SOURCES[account.credentialSource]}${scopes}`;
}

/** Account state word with its glyph, for the accounts sheet. */
export function accountStateLabel(account: AccountState): string {
  return STATE_LABELS[account.state];
}

const STATE_LABELS: Readonly<Record<AccountState["state"], string>> = {
  connected: "✓ Connected",
  error: "✕ Error",
  expired: "! Expired",
};

/**
 * Disconnect modes this account offers, default first: a saved token is always
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

/** Button copy of one disconnect mode. */
export const DISCONNECT_LABELS: Readonly<Record<DisconnectMode, string>> = {
  forgetToken: "Disconnect and forget token",
  logoutHost: "Log out on host",
  unlink: "Disconnect",
};

/** Onboarding shows until some enabled provider has a linked account, whatever its state. */
export function hasLinkedAccount(snapshot: ForgeAccountsSnapshot): boolean {
  return snapshot.accounts.some((account) =>
    snapshot.providers.some(
      (provider) => provider.enabled && provider.pluginId === account.pluginId,
    ),
  );
}
