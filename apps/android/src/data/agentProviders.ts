/**
 * Validated client view of the Companion's provider list.
 *
 * `companion/agentProviders/read` and the durable notification
 * `companion/agentProviders/changed` carry every configured agent provider with
 * its status, sign-in state and declared capabilities, plus the server's
 * host-level capabilities (`AgentProvidersReadResult` in
 * `packages/agent-protocol`). A provider is never a pool account, and the
 * Companion never sends credentials here: sign-in is a state, an opaque plan
 * label and the signed-in account label. A provider that reports subscription
 * limits without an account pool (Claude) carries them as `rateLimits`.
 *
 * An older Companion does not know the method; the client then has no provider
 * list (`unsupported`) and renders exactly as before.
 */
import { parseAgentProviderId, type AgentProviderId } from "./threadAgent";
import { unknownRecord } from "./unknownRecord";

export const AGENT_PROVIDERS_READ_METHOD = "companion/agentProviders/read";
export const AGENT_PROVIDERS_CHANGED_METHOD = "companion/agentProviders/changed";

/** `disabled`: configured but not enabled; `unavailable`: enabled but unusable on this server. */
export type AgentProviderRuntimeStatus = "disabled" | "live" | "reconnecting" | "unavailable";

/** `unknown`: the provider does not report sign-in state, or has not yet. */
type AgentProviderAuth = "authenticated" | "unauthenticated" | "unknown";

/** One rolling usage window a provider reports for its signed-in subscription. */
export type ProviderLimitWindow = {
  /** Stable per provider, e.g. `five_hour` or `seven_day`; windows merge by it. */
  readonly id: string;
  readonly kind: "other" | "session" | "weekly";
  /** Provider display label such as `Weekly · Opus`. */
  readonly label: string;
  /** Unix seconds; `null` when the provider did not say. */
  readonly resetsAt: number | null;
  readonly status: "allowed" | "rejected" | "warning" | null;
  /** Share used, 0–100; `null` when only a status is known. */
  readonly usedPercent: number | null;
  readonly windowDurationMins: number | null;
};

/**
 * Provider-level subscription limits (not an account pool):
 * - `notReported` — the provider does not report them (the entry has no `rateLimits`);
 * - `pending` — it reports them but has not yet (`rateLimits: null`), shown as unknown;
 * - `known` — the latest full snapshot.
 */
export type ProviderLimits =
  | { readonly kind: "notReported" }
  | { readonly kind: "pending" }
  | {
      readonly kind: "known";
      /** Unix seconds of the provider's latest report. */
      readonly updatedAt: number;
      readonly windows: readonly ProviderLimitWindow[];
    };

/** One configured provider of a server. */
export type AgentProviderStatusEntry = {
  /** Signed-in account (email or organization) when the provider reports one; `null` otherwise. */
  readonly accountLabel: string | null;
  readonly auth: AgentProviderAuth;
  /** Supported capability names; `null` for a disabled provider. */
  readonly capabilities: readonly string[] | null;
  readonly id: AgentProviderId;
  readonly limits: ProviderLimits;
  readonly name: string;
  /** Opaque plan label such as `max`; `null` when unknown or signed out. */
  readonly planLabel: string | null;
  readonly primary: boolean;
  readonly status: AgentProviderRuntimeStatus;
};

/** The server's providers and the host-level capabilities some enabled provider declares. */
export type AgentProvidersSnapshot = {
  readonly hostCapabilities: readonly string[];
  readonly providers: readonly AgentProviderStatusEntry[];
};

/** Per-connection resource state; `unsupported` means an older Companion without the method. */
export type AgentProvidersState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly value: AgentProvidersSnapshot | null }
  | { readonly status: "ready"; readonly value: AgentProvidersSnapshot }
  | { readonly status: "unsupported" }
  | {
      readonly error: string;
      readonly status: "error";
      readonly value: AgentProvidersSnapshot | null;
    };

/** A provider list matters to the user only when the server has more than one provider. */
export const MULTI_PROVIDER_COUNT = 2;
const MAX_PROVIDERS = 32;
const MAX_NAME_CHARACTERS = 64;
const MAX_PLAN_LABEL_CHARACTERS = 64;
const MAX_CAPABILITIES = 256;
const MAX_CAPABILITY_CHARACTERS = 128;
const MAX_ACCOUNT_LABEL_CHARACTERS = 254;
const MAX_LIMIT_WINDOWS = 16;
const MAX_WINDOW_ID_CHARACTERS = 64;
const MAX_WINDOW_LABEL_CHARACTERS = 64;
const PERCENT_MAX = 100;
const NOT_REPORTED: ProviderLimits = { kind: "notReported" };
const PENDING: ProviderLimits = { kind: "pending" };

/** Validates one read result or change notification payload; `null` for any other shape. */
export function parseAgentProvidersResult(value: unknown): AgentProvidersSnapshot | null {
  const record = unknownRecord(value);
  const rows: unknown = record?.providers;
  if (record === null || !Array.isArray(rows) || rows.length > MAX_PROVIDERS) {
    return null;
  }
  const providers: AgentProviderStatusEntry[] = [];
  for (const row of rows) {
    const entry = parseEntry(row);
    if (entry === null) {
      return null;
    }
    providers.push(entry);
  }
  const hostCapabilities = supportedNames(record.hostCapabilities);
  return hostCapabilities === null ? null : { hostCapabilities, providers };
}

/**
 * Whether the server declares a host-level capability: `null` while the provider
 * list is unknown (older Companion, not loaded yet), so callers keep their own
 * fallback such as probing for `-32072`.
 */
export function hostDeclaresCapability(
  state: AgentProvidersState | undefined,
  capability: string,
): boolean | null {
  const value = state === undefined ? null : agentProvidersValue(state);
  return value === null ? null : value.hostCapabilities.includes(capability);
}

/** The last known snapshot of a state, if any. */
export function agentProvidersValue(state: AgentProvidersState): AgentProvidersSnapshot | null {
  return state.status === "idle" || state.status === "unsupported" ? null : state.value;
}

/**
 * Whether the server offers an account pool: only a provider declaring
 * `accounts.pool` does. `owner` is `null` for an older Companion without the
 * provider list, which always served one pool; the list is `pending` until read.
 */
export type AccountPoolPresence =
  | { readonly kind: "absent" }
  | { readonly kind: "pending" }
  | { readonly kind: "present"; readonly owner: AgentProviderStatusEntry | null };

/** The account pool of a server's provider list (see {@link AccountPoolPresence}). */
export function accountPoolPresence(state: AgentProvidersState | undefined): AccountPoolPresence {
  if (state?.status === "unsupported") {
    return { kind: "present", owner: null };
  }
  const value = state === undefined ? null : agentProvidersValue(state);
  if (value === null) {
    return { kind: "pending" };
  }
  const owner = value.providers.find(
    (entry) => entry.capabilities?.includes("accounts.pool") === true,
  );
  return owner === undefined ? { kind: "absent" } : { kind: "present", owner };
}

function parseEntry(value: unknown): AgentProviderStatusEntry | null {
  const row = unknownRecord(value);
  const id = parseAgentProviderId(row?.id);
  const state = row === null ? null : entryState(row);
  if (row === null || id === null || state === null) {
    return null;
  }
  return {
    accountLabel: boundedText(row.accountLabel, MAX_ACCOUNT_LABEL_CHARACTERS),
    auth: state.auth,
    capabilities: state.capabilities,
    id,
    limits: entryLimits(row),
    name: boundedText(row.name, MAX_NAME_CHARACTERS) ?? id,
    planLabel: boundedText(row.planLabel, MAX_PLAN_LABEL_CHARACTERS),
    primary: state.primary,
    status: state.status,
  };
}

/** The closed-vocabulary fields of one entry; `null` when any is invalid. */
function entryState(
  row: Record<string, unknown>,
): Pick<AgentProviderStatusEntry, "auth" | "capabilities" | "primary" | "status"> | null {
  const { auth, primary, status } = row;
  const capabilities = entryCapabilities(row.capabilities);
  if (
    !isRuntimeStatus(status) ||
    !isAuth(auth) ||
    typeof primary !== "boolean" ||
    capabilities === undefined
  ) {
    return null;
  }
  return { auth, capabilities, primary, status };
}

/** `null` for a disabled provider, `undefined` for an invalid shape. */
function entryCapabilities(value: unknown): readonly string[] | null | undefined {
  return value === null ? null : (supportedNames(value) ?? undefined);
}

/** Absent `rateLimits`: the provider does not report provider-level limits. */
function entryLimits(row: Record<string, unknown>): ProviderLimits {
  return Object.hasOwn(row, "rateLimits") ? parseLimits(row.rateLimits) : NOT_REPORTED;
}

/**
 * A provider that reports limits but sends an unusable snapshot reads as
 * pending (unknown) rather than dropping the whole provider list; invalid
 * windows are skipped.
 */
function parseLimits(value: unknown): ProviderLimits {
  const record = unknownRecord(value);
  const rows = record === null ? null : boundedWindowRows(record.windows);
  const updatedAt: unknown = record?.updatedAt;
  if (rows === null || !isPositiveInteger(updatedAt)) {
    return PENDING;
  }
  const windows: ProviderLimitWindow[] = [];
  for (const row of rows) {
    const window = parseLimitWindow(row);
    if (window !== null) {
      windows.push(window);
    }
  }
  return { kind: "known", updatedAt, windows };
}

function boundedWindowRows(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) && value.length <= MAX_LIMIT_WINDOWS ? value : null;
}

function parseLimitWindow(value: unknown): ProviderLimitWindow | null {
  const row = unknownRecord(value);
  const identity = row === null ? null : limitWindowIdentity(row);
  if (row === null || identity === null) {
    return null;
  }
  return {
    id: identity.id,
    kind: identity.kind,
    label: identity.label,
    resetsAt: positiveIntegerOrNull(row.resetsAt),
    status: identity.status,
    usedPercent: isPercent(row.usedPercent) ? row.usedPercent : null,
    windowDurationMins: positiveIntegerOrNull(row.windowDurationMins),
  };
}

/** The closed-vocabulary and naming fields of one window; `null` when any is invalid. */
function limitWindowIdentity(
  row: Record<string, unknown>,
): Pick<ProviderLimitWindow, "id" | "kind" | "label" | "status"> | null {
  const id = boundedText(row.id, MAX_WINDOW_ID_CHARACTERS);
  const label = boundedText(row.label, MAX_WINDOW_LABEL_CHARACTERS);
  const { kind, status } = row;
  if (id === null || label === null || !isWindowKind(kind) || !isWindowStatus(status)) {
    return null;
  }
  return { id, kind, label, status };
}

function positiveIntegerOrNull(value: unknown): number | null {
  return isPositiveInteger(value) ? value : null;
}

function isWindowKind(value: unknown): value is ProviderLimitWindow["kind"] {
  return value === "session" || value === "weekly" || value === "other";
}

function isWindowStatus(value: unknown): value is ProviderLimitWindow["status"] {
  return value === null || value === "allowed" || value === "warning" || value === "rejected";
}

/** Unix seconds and window lengths are positive integers. */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isPercent(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= PERCENT_MAX;
}

function isRuntimeStatus(value: unknown): value is AgentProviderRuntimeStatus {
  return (
    value === "disabled" || value === "live" || value === "reconnecting" || value === "unavailable"
  );
}

function isAuth(value: unknown): value is AgentProviderAuth {
  return value === "authenticated" || value === "unauthenticated" || value === "unknown";
}

function boundedText(value: unknown, limit: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" || trimmed.length > limit ? null : trimmed;
}

/** Names whose value is `true` or a non-empty mode string. */
function supportedNames(value: unknown): string[] | null {
  const record = unknownRecord(value);
  if (record === null) {
    return null;
  }
  const names = Object.entries(record)
    .filter(([name, declared]) => isSupportedEntry(name, declared))
    .map(([name]) => name);
  return names.length > MAX_CAPABILITIES ? null : names;
}

function isSupportedEntry(name: string, declared: unknown): boolean {
  return (
    name.length > 0 &&
    name.length <= MAX_CAPABILITY_CHARACTERS &&
    (declared === true || (typeof declared === "string" && declared !== ""))
  );
}
