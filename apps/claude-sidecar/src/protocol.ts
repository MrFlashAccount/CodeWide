/**
 * The sidecar's view of the `codewide-agent` v1 contract.
 *
 * Types come from `@codewide/agent-protocol` through `import type` only, so
 * the built `dist/` never imports a workspace package at runtime. The few
 * runtime constants the sidecar needs are restated here and checked against
 * the protocol types with `satisfies`, so a protocol change that removes or
 * renames one breaks the typecheck instead of drifting silently.
 */

import type {
  AppThreadId,
  CapabilitySet,
  ClientMessageId,
  ItemId,
  ProviderDescriptor,
  ProviderId,
  TurnId,
} from "@codewide/agent-protocol";

export type * from "@codewide/agent-protocol";

export const PROTOCOL_NAME = "codewide-agent";
export const PROTOCOL_VERSION = 1;

export const PROVIDER_ID = "claude" as ProviderId; // WHY: the brand is applied to a constant literal that is this provider's identity.

export const ERROR_CODES = {
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  capabilityUnsupported: -32072,
} as const;

/** The Claude column of the capability table (canvas r3, "Capabilities"). */
export const CLAUDE_CAPABILITIES = {
  "turns.steer": true,
  "turns.providerInitiated": true,
  "threads.hostMintedIds": true,
  "threads.externalDiscovery": false,
  "threads.compact": true,
  "threads.fork": false,
  "requests.userInput": true,
  "requests.mcpElicitation": false,
  "requests.dynamicToolCall": false,
  "settings.serviceTier": false,
  "settings.personality": false,
  "input.skillsAndMentions": false,
  "catalog.skillsPlugins": false,
  review: false,
  goals: false,
  backgroundTerminals: false,
  realtimeVoice: false,
  globalSupervisor: false,
  subagentThreads: false,
  "accounts.pool": false,
  "accounts.rateLimits": false,
  "history.threadResources": false,
  "history.messageSearch": false,
  "host.fs": false,
  "host.config": false,
  "codex.native": false,
  "turns.startWhileActive": "busy",
} as const satisfies CapabilitySet;

export function providerDescriptor(version: string): ProviderDescriptor {
  return { id: PROVIDER_ID, displayName: "Claude", modelProvider: "anthropic", version };
}

export const threadNotFoundMessage = (appThreadId: string): string => `thread not found: ${appThreadId}`;
export const EXPECTED_TURN_NOT_ACTIVE = "expected turn is not active";
export const capabilityUnsupportedMessage = (capability: string): string =>
  `${capability} is not supported by this thread's agent`;

/*
 * Brand constructors. Each is called only after the value has been validated
 * at the RPC boundary or minted by the sidecar itself.
 */
// WHY (all four): brands are compile-time only; these functions are the single
// place where a validated or self-minted string becomes a nominal id.
export const asAppThreadId = (value: string): AppThreadId => value as AppThreadId;
export const asTurnId = (value: string): TurnId => value as TurnId;
export const asItemId = (value: string): ItemId => value as ItemId;
export const asClientMessageId = (value: string): ClientMessageId => value as ClientMessageId;
