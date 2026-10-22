/**
 * Validated client view of the Companion forge account contract
 * (`companion/forge/accounts/read` and the auth mutations).
 *
 * Forge tokens never appear here: an account carries only its credential
 * source, login and scopes. Opaque identifiers are branded once at this
 * boundary and are never parsed by Android.
 */
import { sanitizeForgeGlyph, type ForgeGlyph } from "./forgeGlyph";
import {
  decodeOrNull,
  flag,
  list,
  nonEmptyText,
  oneOf,
  optionalText,
  record,
  text,
  textList,
} from "./forgeWire";

declare const pullRequestKeyBrand: unique symbol;
declare const forgeAccountKeyBrand: unique symbol;
declare const headRevisionBrand: unique symbol;
declare const authFlowIdBrand: unique symbol;

/** Companion-issued opaque PR identity (`fpr1.…`); never parsed on the device. */
export type PullRequestKey = string & { readonly [pullRequestKeyBrand]: true };
/** Opaque `pluginId + host + login` account identity. */
export type ForgeAccountKey = string & { readonly [forgeAccountKeyBrand]: true };
/** Opaque forge revision: a head SHA on GitHub, a diff-set id on Arcanum. */
export type HeadRevision = string & { readonly [headRevisionBrand]: true };
/** Companion-generated id of one connect attempt. */
type AuthFlowId = string & { readonly [authFlowIdBrand]: true };

/** Brands a validated non-empty PR key. */
export function pullRequestKey(value: unknown, path: string): PullRequestKey {
  // WHY: the brand records that the value passed the non-empty wire check above; no runtime shape changes.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return nonEmptyText(value, path) as PullRequestKey;
}

/** Brands a validated non-empty account key. */
export function forgeAccountKey(value: unknown, path: string): ForgeAccountKey {
  // WHY: the brand records that the value passed the non-empty wire check above; no runtime shape changes.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return nonEmptyText(value, path) as ForgeAccountKey;
}

/** Brands a validated non-empty head revision. */
export function headRevision(value: unknown, path: string): HeadRevision {
  // WHY: the brand records that the value passed the non-empty wire check above; no runtime shape changes.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return nonEmptyText(value, path) as HeadRevision;
}

function authFlowId(value: unknown, path: string): AuthFlowId {
  // WHY: the brand records that the value passed the non-empty wire check above; no runtime shape changes.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return nonEmptyText(value, path) as AuthFlowId;
}

/** Bundled brand key plus an optional sanitized plugin glyph. */
export type ProviderIcon = { readonly glyph: ForgeGlyph | null; readonly iconKey: string };

/** How a provider connects an account: link a host login, run a host login, paste a token, or follow host steps. */
type AuthMethodKind = "hostLogin" | "instructions" | "linkExisting" | "pasteToken";
/** `unlink` keeps the host login; `forgetToken` deletes a saved token; `logoutHost` signs the host tool out. */
export type DisconnectMode = "forgetToken" | "logoutHost" | "unlink";

/** One way to connect an account, as the provider plugin declares it for a host. */
export type AuthMethod = {
  readonly available: boolean;
  readonly detail: string;
  readonly disconnectModes: readonly DisconnectMode[];
  readonly existingLogins: readonly string[];
  readonly kind: AuthMethodKind;
  readonly label: string;
  readonly links: readonly { readonly label: string; readonly url: string }[];
  readonly methodId: string;
  readonly purpose: "account" | "checks";
  readonly requiredPermissions: readonly string[];
  readonly unavailableReason: string | null;
};

/** A registered forge provider. Android branches on capabilities and kinds, never on its name. */
export type ForgeProvider = {
  readonly authMethods: readonly AuthMethod[];
  readonly builtIn: boolean;
  readonly capabilities: readonly string[];
  readonly checksCredential: "connected" | "missing" | "notApplicable";
  /** Host a connect attempt starts on; `null` (an external provider that cannot start) disables Connect. */
  readonly defaultHost: string | null;
  readonly enabled: boolean;
  readonly forgeName: string;
  readonly icon: ProviderIcon;
  readonly pluginId: string;
};

/**
 * A host-login flow. While awaiting the user it carries a transient one-time
 * code (never a token); a flow whose host tool failed after showing the code
 * stays listed with its reason until it is dismissed or retried.
 */
export type AuthFlow = {
  readonly flowId: AuthFlowId;
  readonly host: string;
  readonly methodId: string;
  readonly pluginId: string;
} & (
  | {
      readonly expiresAt: string;
      readonly state: "awaitingUser";
      readonly userCode: string;
      readonly verificationUri: string;
    }
  | { readonly reason: string; readonly retryable: boolean; readonly state: "failed" }
);

type AccountIdentity = {
  readonly account: ForgeAccountKey;
  readonly credentialSource: "arcToken" | "environment" | "ghCli" | "savedToken";
  readonly host: string;
  readonly linkedAt: string;
  readonly login: string;
  readonly pluginId: string;
  readonly scopes: readonly string[] | null;
};

/** Derived state of a linked account; `connecting` is a flow, not an account state. */
export type AccountState = AccountIdentity &
  (
    | { readonly state: "connected" }
    | { readonly hint: string; readonly state: "expired" }
    | { readonly reason: string; readonly state: "error" }
  );

/** Result of `companion/forge/accounts/read`. */
export type ForgeAccountsSnapshot = {
  readonly accounts: readonly AccountState[];
  readonly flows: readonly AuthFlow[];
  readonly providers: readonly ForgeProvider[];
};

/** Decodes the provider icon; an unsafe glyph becomes `null` instead of failing the read. */
export function providerIcon(value: unknown, path: string): ProviderIcon {
  const icon = record(value, path);
  return { glyph: sanitizeForgeGlyph(icon.glyph), iconKey: text(icon.iconKey, `${path}.iconKey`) };
}

function authMethod(value: unknown, path: string): AuthMethod {
  const method = record(value, path);
  return {
    available: flag(method.available, `${path}.available`),
    detail: text(method.detail, `${path}.detail`),
    disconnectModes: list(method.disconnectModes, `${path}.disconnectModes`, (mode, modePath) =>
      oneOf(mode, ["unlink", "logoutHost", "forgetToken"], modePath),
    ),
    existingLogins: textList(method.existingLogins, `${path}.existingLogins`),
    kind: oneOf(
      method.kind,
      ["linkExisting", "hostLogin", "pasteToken", "instructions"],
      `${path}.kind`,
    ),
    label: text(method.label, `${path}.label`),
    links: list(method.links, `${path}.links`, (link, linkPath) => {
      const entry = record(link, linkPath);
      return {
        label: text(entry.label, `${linkPath}.label`),
        url: text(entry.url, `${linkPath}.url`),
      };
    }),
    methodId: nonEmptyText(method.methodId, `${path}.methodId`),
    purpose: oneOf(method.purpose, ["account", "checks"], `${path}.purpose`),
    requiredPermissions: textList(method.requiredPermissions, `${path}.requiredPermissions`),
    unavailableReason: optionalText(method.unavailableReason, `${path}.unavailableReason`),
  };
}

function forgeProvider(value: unknown, path: string): ForgeProvider {
  const provider = record(value, path);
  const checks = record(provider.checksCredential, `${path}.checksCredential`);
  return {
    authMethods: list(provider.authMethods, `${path}.authMethods`, authMethod),
    builtIn: flag(provider.builtIn, `${path}.builtIn`),
    capabilities: textList(provider.capabilities, `${path}.capabilities`),
    checksCredential: oneOf(
      checks.state,
      ["connected", "missing", "notApplicable"],
      `${path}.checksCredential.state`,
    ),
    defaultHost: optionalText(provider.defaultHost, `${path}.defaultHost`),
    enabled: flag(provider.enabled, `${path}.enabled`),
    forgeName: text(provider.forgeName, `${path}.forgeName`),
    icon: providerIcon(provider.icon, `${path}.icon`),
    pluginId: nonEmptyText(provider.pluginId, `${path}.pluginId`),
  };
}

function authFlow(value: unknown, path: string): AuthFlow {
  const flow = record(value, path);
  const identity = {
    flowId: authFlowId(flow.flowId, `${path}.flowId`),
    host: nonEmptyText(flow.host, `${path}.host`),
    methodId: nonEmptyText(flow.methodId, `${path}.methodId`),
    pluginId: nonEmptyText(flow.pluginId, `${path}.pluginId`),
  };
  const state = oneOf(flow.state, ["awaitingUser", "failed"], `${path}.state`);
  if (state === "failed") {
    return {
      ...identity,
      reason: text(flow.reason, `${path}.reason`),
      retryable: flag(flow.retryable, `${path}.retryable`),
      state,
    };
  }
  return {
    ...identity,
    expiresAt: text(flow.expiresAt, `${path}.expiresAt`),
    state,
    userCode: nonEmptyText(flow.userCode, `${path}.userCode`),
    verificationUri: nonEmptyText(flow.verificationUri, `${path}.verificationUri`),
  };
}

/** Decodes one derived account state. */
export function accountState(value: unknown, path: string): AccountState {
  const account = record(value, path);
  const identity: AccountIdentity = {
    account: forgeAccountKey(account.account, `${path}.account`),
    credentialSource: oneOf(
      account.credentialSource,
      ["savedToken", "environment", "ghCli", "arcToken"],
      `${path}.credentialSource`,
    ),
    host: nonEmptyText(account.host, `${path}.host`),
    linkedAt: text(account.linkedAt, `${path}.linkedAt`),
    login: nonEmptyText(account.login, `${path}.login`),
    pluginId: nonEmptyText(account.pluginId, `${path}.pluginId`),
    scopes: account.scopes === null ? null : textList(account.scopes, `${path}.scopes`),
  };
  const state = oneOf(account.state, ["connected", "expired", "error"], `${path}.state`);
  if (state === "expired") {
    return { ...identity, hint: text(account.hint, `${path}.hint`), state };
  }
  if (state === "error") {
    return { ...identity, reason: text(account.reason, `${path}.reason`), state };
  }
  return { ...identity, state };
}

/** Parses `companion/forge/accounts/read`; any contract mismatch yields `null`. */
export function parseForgeAccounts(value: unknown): ForgeAccountsSnapshot | null {
  return decodeOrNull(() => {
    const snapshot = record(value, "result");
    return {
      accounts: list(snapshot.accounts, "accounts", accountState),
      flows: list(snapshot.flows, "flows", authFlow),
      providers: list(snapshot.providers, "providers", forgeProvider),
    };
  });
}

/** Result of `companion/forge/auth/start`: a host-login flow or an already linked account. */
export type AuthStartResult =
  | { readonly flow: AuthFlow; readonly kind: "flow" }
  | { readonly account: AccountState; readonly kind: "connected" };

/** Parses `companion/forge/auth/start`. */
export function parseAuthStart(value: unknown): AuthStartResult | null {
  return decodeOrNull(() => {
    const result = record(value, "result");
    const kind = oneOf(result.kind, ["flow", "connected"], "kind");
    return kind === "flow"
      ? { flow: authFlow(result.flow, "flow"), kind }
      : { account: accountState(result.account, "account"), kind };
  });
}

/** Parses `companion/forge/auth/submitToken`; the result never contains the token. */
export function parseSubmitToken(value: unknown): AccountState | null {
  return decodeOrNull(() => accountState(record(value, "result").account, "account"));
}

/** Parses `companion/forge/provider/setEnabled`. */
export function parseProviderResult(value: unknown): ForgeProvider | null {
  return decodeOrNull(() => forgeProvider(record(value, "result").provider, "provider"));
}

/** Brands a PR key taken from a route parameter; `null` when it is not a non-empty string. */
export function parsePullRequestKeyParam(value: unknown): PullRequestKey | null {
  return decodeOrNull(() => pullRequestKey(value, "pullRequestKey"));
}
