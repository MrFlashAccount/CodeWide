import { type ThreadAgent, threadAgentDeclares } from "../../../data/threadAgent";
import type { TurnControlsValue } from "../../../data/turn-controls-types";

/**
 * Profile a thread of a neutral provider (one without the native Codex
 * surface) starts with when the client names none: the Companion's
 * `thread/start` default for providers served through the neutral
 * `thread.create` (`crates/companion-core/src/agent/client_wire/gateway.rs`).
 */
const NEUTRAL_PROVIDER_DEFAULT_PROFILE = ":workspace";

/**
 * Which provider's default applies. A legacy server, a legacy thread and an
 * unannotated catalog are served by the native Codex provider, whose default
 * is the host configuration that `config/read` reports.
 */
export type PermissionDefaultScope = "native" | "neutral";

/**
 * The default scope of an existing thread from its agent descriptor: the
 * provider declaring `codex.native` (Codex) uses the host configuration.
 */
export function threadPermissionDefaultScope(agent: ThreadAgent | null): PermissionDefaultScope {
  return agent === null || threadAgentDeclares(agent, "codex.native") ? "native" : "neutral";
}

/**
 * The default scope of a new chat: the provider of the chosen model. The
 * native provider owns the catalog's single default row.
 */
export function newChatPermissionDefaultScope(
  controls: TurnControlsValue,
  model: string | null,
): PermissionDefaultScope {
  const provider = controls.models.find((candidate) => candidate.id === model)?.provider ?? null;
  const native = controls.models.find((candidate) => candidate.isDefault)?.provider ?? null;
  return provider === null || provider === native ? "native" : "neutral";
}

/**
 * The profile id "Server default" stands for, or `null` when it is unknown:
 * the native host reports no profile (e.g. a granular legacy configuration)
 * or its configuration has not loaded yet.
 */
export function resolvedDefaultPermissions(
  controls: TurnControlsValue,
  scope: PermissionDefaultScope,
): string | null {
  return scope === "native" ? controls.defaults.permissions : NEUTRAL_PROVIDER_DEFAULT_PROFILE;
}
