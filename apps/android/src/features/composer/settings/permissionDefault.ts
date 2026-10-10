import type { ThreadAgent } from "../../../data/threadAgent";
import type { TurnControlsValue } from "../../../data/turn-controls-types";

/**
 * Profile a thread of a non-primary (neutral) provider starts with when the
 * client names none: the Companion's `thread/start` default for providers
 * served through the neutral `thread.create`
 * (`crates/companion-core/src/agent/client_wire/gateway.rs`).
 */
const NEUTRAL_PROVIDER_DEFAULT_PROFILE = ":workspace";

/**
 * Which provider's default applies. A legacy server, a legacy thread and an
 * unannotated catalog are served by the primary provider (Codex), whose default
 * is the host configuration that `config/read` reports.
 */
export type PermissionDefaultScope = "neutral" | "primary";

/** The default scope of an existing thread from its agent descriptor. */
export function threadPermissionDefaultScope(agent: ThreadAgent | null): PermissionDefaultScope {
  return agent === null || agent.primary ? "primary" : "neutral";
}

/**
 * The default scope of a new chat: the provider of the chosen model. The
 * primary provider owns the catalog's single default row.
 */
export function newChatPermissionDefaultScope(
  controls: TurnControlsValue,
  model: string | null,
): PermissionDefaultScope {
  const provider = controls.models.find((candidate) => candidate.id === model)?.provider ?? null;
  const primary = controls.models.find((candidate) => candidate.isDefault)?.provider ?? null;
  return provider === null || provider === primary ? "primary" : "neutral";
}

/**
 * The profile id "Server default" stands for, or `null` when it is unknown:
 * the primary host reports no profile (e.g. a granular legacy configuration)
 * or its configuration has not loaded yet.
 */
export function resolvedDefaultPermissions(
  controls: TurnControlsValue,
  scope: PermissionDefaultScope,
): string | null {
  return scope === "primary" ? controls.defaults.permissions : NEUTRAL_PROVIDER_DEFAULT_PROFILE;
}
