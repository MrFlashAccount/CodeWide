/**
 * Validated client view of the Companion's provider list.
 *
 * `companion/agentProviders/read` and the durable notification
 * `companion/agentProviders/changed` carry every configured agent provider with
 * its status, sign-in state and declared capabilities, plus the server's
 * host-level capabilities (`AgentProvidersReadResult` in
 * `packages/agent-protocol`). A provider is never a pool account, and the
 * Companion never sends credentials here: sign-in is a state plus an opaque
 * plan label.
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

/** One configured provider of a server. */
export type AgentProviderStatusEntry = {
  readonly auth: AgentProviderAuth;
  /** Supported capability names; `null` for a disabled provider. */
  readonly capabilities: readonly string[] | null;
  readonly id: AgentProviderId;
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
 * Name of the provider that owns the server's account pool (`accounts.pool`),
 * only when the server lists several providers; `null` otherwise, so a
 * single-provider or older server keeps its plain "Accounts" wording.
 */
export function accountPoolOwnerName(state: AgentProvidersState | undefined): string | null {
  const value = state === undefined ? null : agentProvidersValue(state);
  if (value === null || value.providers.length < MULTI_PROVIDER_COUNT) {
    return null;
  }
  return (
    value.providers.find((entry) => entry.capabilities?.includes("accounts.pool") === true)?.name ??
    null
  );
}

function parseEntry(value: unknown): AgentProviderStatusEntry | null {
  const row = unknownRecord(value);
  const id = parseAgentProviderId(row?.id);
  const state = row === null ? null : entryState(row);
  if (row === null || id === null || state === null) {
    return null;
  }
  return {
    auth: state.auth,
    capabilities: state.capabilities,
    id,
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
