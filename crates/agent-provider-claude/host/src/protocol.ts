/**
 * The Claude agent host's view of the `codewide-agent` v1 contract.
 *
 * Types come from `@codewide/agent-protocol` through `import type` only, so
 * the built `dist/` never imports a workspace package at runtime. The few
 * runtime constants the host needs are restated here and checked against
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
  ProviderThreadRef,
  TurnId,
} from "@codewide/agent-protocol";

export type * from "@codewide/agent-protocol";

export const PROTOCOL_NAME = "codewide-agent";
export const PROTOCOL_VERSION = 1;

// WHY: the brand is applied to the constant literal that is this provider's identity.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
export const PROVIDER_ID = "claude" as ProviderId;

const INVALID_REQUEST = -32_600;
const METHOD_NOT_FOUND = -32_601;
const INVALID_PARAMS = -32_602;
const INTERNAL_ERROR = -32_603;
const CAPABILITY_UNSUPPORTED = -32_072;

export const ERROR_CODES = {
  capabilityUnsupported: CAPABILITY_UNSUPPORTED,
  internal: INTERNAL_ERROR,
  invalidParams: INVALID_PARAMS,
  invalidRequest: INVALID_REQUEST,
  methodNotFound: METHOD_NOT_FOUND,
} as const;

/** The Claude column of the capability table (canvas r3, "Capabilities"). */
export const CLAUDE_CAPABILITIES = {
  "accounts.pool": false,
  "accounts.rateLimits": false,
  backgroundTerminals: false,
  "catalog.skillsPlugins": false,
  "codex.native": false,
  globalSupervisor: false,
  goals: false,
  "history.messageSearch": false,
  "history.threadResources": false,
  "host.config": false,
  "host.fs": false,
  "input.skillsAndMentions": false,
  "orchestration.tools": true,
  realtimeVoice: false,
  "requests.dynamicToolCall": false,
  "requests.mcpElicitation": false,
  "requests.userInput": true,
  review: false,
  "settings.personality": false,
  "settings.serviceTier": false,
  subagentThreads: false,
  "threads.compact": true,
  "threads.crossProviderFork": true,
  "threads.externalDiscovery": true,
  "threads.fork": false,
  "threads.hostMintedIds": true,
  "turns.providerInitiated": true,
  "turns.startWhileActive": "busy",
  "turns.steer": true,
} as const satisfies CapabilitySet;

export function providerDescriptor(version: string): ProviderDescriptor {
  return { displayName: "Claude", id: PROVIDER_ID, modelProvider: "anthropic", version };
}

export const threadNotFoundMessage = (appThreadId: string): string =>
  `thread not found: ${appThreadId}`;
export const EXPECTED_TURN_NOT_ACTIVE = "expected turn is not active";
export const nativeSessionNotFoundMessage = (sessionId: string): string =>
  `native session not found: ${sessionId}`;
export const capabilityUnsupportedMessage = (capability: string): string =>
  `${capability} is not supported by this thread's agent`;

/*
 * Brand constructors. Each is called only after the value has been validated
 * at the RPC boundary or minted by the host itself.
 */
// WHY: a brand exists only in the type system, so no runtime check can produce
// it; callers pass only values validated at the RPC boundary, read back from
// the host's checked state, or minted by the host.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
export const asAppThreadId = (value: string): AppThreadId => value as AppThreadId;
// WHY: a brand exists only in the type system, so no runtime check can produce
// it; callers pass only values validated at the RPC boundary, read back from
// the host's checked state, or minted by the host.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
export const asTurnId = (value: string): TurnId => value as TurnId;
// WHY: a brand exists only in the type system, so no runtime check can produce
// it; callers pass only values validated at the RPC boundary, read back from
// the host's checked state, or minted by the host.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
export const asItemId = (value: string): ItemId => value as ItemId;
// WHY: a brand exists only in the type system, so no runtime check can produce
// it; the native thread ref of a Claude thread is its validated app thread id.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
export const asProviderThreadRef = (value: string): ProviderThreadRef => value as ProviderThreadRef;
// WHY: a brand exists only in the type system, so no runtime check can produce
// it; callers pass only values validated at the RPC boundary, read back from
// the host's checked state, or minted by the host.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
export const asClientMessageId = (value: string): ClientMessageId => value as ClientMessageId;
