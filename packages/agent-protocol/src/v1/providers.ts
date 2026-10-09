/**
 * Provider health and sign-in state.
 *
 * Two contracts live here:
 *
 * - the neutral provider → companion notification `account.updated`, sent by a
 *   provider whenever its signed-in state changes after `initialize` (for
 *   example after the user signs in to the provider's CLI on the server);
 * - the companion's client-wire read `companion/agentProviders/read` and its
 *   durable change notification `companion/agentProviders/changed`, which list
 *   every configured provider with its status, sign-in state and declared
 *   capabilities, plus the host-level capabilities of the server.
 *
 * Neither ever carries credentials, tokens, emails or organization names.
 */

import type { AdditiveBooleanCapability, BooleanCapability, CapabilitySet } from "./capabilities";
import type { ProviderAccount } from "./operations";

/** Provider → companion notification: the provider's signed-in state changed. */
export const ACCOUNT_UPDATED_NOTIFICATION = "account.updated" as const;

export interface AccountUpdatedParams {
  readonly account: ProviderAccount;
}

export interface AccountUpdatedNotification {
  readonly method: typeof ACCOUNT_UPDATED_NOTIFICATION;
  readonly params: AccountUpdatedParams;
}

/** Client-wire read of the configured providers (answered in every mode). */
export const AGENT_PROVIDERS_READ_METHOD = "companion/agentProviders/read" as const;

/**
 * Durable client-wire notification with the full `AgentProvidersReadResult`
 * as params. Emitted only in multi-provider mode, whenever a provider's
 * status, sign-in state or capabilities change.
 */
export const AGENT_PROVIDERS_CHANGED_METHOD = "companion/agentProviders/changed" as const;

/**
 * `model/list` result extension (multi-provider mode, first page only): the
 * providers whose catalog is missing from this page because they are not live
 * or their catalog failed. Absent when every provider answered.
 */
export const PROVIDERS_UNAVAILABLE_FIELD = "codewideAgentProvidersUnavailable" as const;

/**
 * - `live` — enabled and connected;
 * - `reconnecting` — enabled, its runtime is (re)starting;
 * - `unavailable` — enabled but unusable on this host (for example a
 *   protocol version mismatch with its runtime);
 * - `disabled` — configured (or bound by earlier threads) but not enabled.
 */
export type AgentProviderStatus = "disabled" | "live" | "reconnecting" | "unavailable";

/** `unknown`: the provider does not report sign-in state, or has not yet. */
export type AgentProviderAuth = "authenticated" | "unauthenticated" | "unknown";

/** One configured provider. Never a pool account. */
export interface AgentProviderEntry {
  readonly auth: AgentProviderAuth;
  /** Declared capability set; `null` for a disabled provider. */
  readonly capabilities: CapabilitySet | null;
  readonly id: string;
  /** Human-readable provider name. */
  readonly name: string;
  /** Opaque plan label reported by the provider (for example `max`); `null` when unknown. */
  readonly planLabel: string | null;
  readonly primary: boolean;
  readonly status: AgentProviderStatus;
}

/**
 * Host-level capabilities: a name is `true` when an enabled provider declares
 * it, so connection-scoped features (for example global voice mode,
 * `realtimeVoice`) are known without probing a call for `-32072`.
 */
export type HostCapabilities = Readonly<
  Partial<Record<AdditiveBooleanCapability | BooleanCapability, boolean>>
>;

export interface AgentProvidersReadResult {
  readonly hostCapabilities: HostCapabilities;
  /** Enabled providers in registry order (primary first), then disabled ones. */
  readonly providers: readonly AgentProviderEntry[];
}
