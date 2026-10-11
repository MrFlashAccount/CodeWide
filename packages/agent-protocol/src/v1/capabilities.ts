/**
 * Capability vocabulary of the `codewide-agent` v1 protocol.
 *
 * A provider declares its complete capability set at `initialize`. The
 * companion routes and degrades features only by these names; no component
 * outside a provider's own adapter decides behavior from a provider id.
 * Adding a name is an additive v1 change: consumers treat an unknown or
 * absent name as unsupported.
 */

/** Capabilities that are either supported or not. */
export const BOOLEAN_CAPABILITIES = [
  "turns.steer",
  "turns.providerInitiated",
  "threads.hostMintedIds",
  "threads.externalDiscovery",
  "threads.compact",
  "threads.fork",
  "requests.userInput",
  "requests.mcpElicitation",
  "requests.dynamicToolCall",
  "settings.serviceTier",
  "settings.personality",
  "input.skillsAndMentions",
  "catalog.skillsPlugins",
  "review",
  "goals",
  "backgroundTerminals",
  "realtimeVoice",
  "globalSupervisor",
  "subagentThreads",
  "accounts.pool",
  "accounts.rateLimits",
  "history.threadResources",
  "history.messageSearch",
  "host.fs",
  "host.config",
  "codex.native",
] as const;

export type BooleanCapability = (typeof BOOLEAN_CAPABILITIES)[number];

/**
 * Boolean capabilities added within v1 after the first declaration shape. A
 * provider built before them omits them, which means unsupported.
 * `orchestration.tools`: the provider registers the companion's client tools
 * (`clientTools`) for its model and calls them back with `tool.call`.
 * `threads.crossProviderFork`: a thread of this provider can be forked into a
 * thread of another provider (a context handoff by the companion) and receive
 * such a fork.
 */
export const ADDITIVE_BOOLEAN_CAPABILITIES = [
  "orchestration.tools",
  "threads.crossProviderFork",
] as const;

export type AdditiveBooleanCapability = (typeof ADDITIVE_BOOLEAN_CAPABILITIES)[number];

/**
 * What a provider does with `turn.start` while a turn of the same thread is
 * active. `busy`: it refuses with `busy {activeTurnId}` and the companion
 * keeps the command queued. `nativeJoin`: the provider joins the active turn
 * itself and reports `started` with that turn id.
 */
export type StartWhileActiveMode = "busy" | "nativeJoin";

export const START_WHILE_ACTIVE_CAPABILITY = "turns.startWhileActive" as const;

/** Every capability name in v1. */
export type CapabilityName =
  | BooleanCapability
  | AdditiveBooleanCapability
  | typeof START_WHILE_ACTIVE_CAPABILITY;

/**
 * The complete capability declaration of one provider. Every original v1
 * name is present, so "declared unsupported" (`false`) is distinguishable
 * from a name the consumer does not know yet; an additive name may be absent
 * (unsupported).
 */
export type CapabilitySet = Readonly<Record<BooleanCapability, boolean>> &
  Readonly<Partial<Record<AdditiveBooleanCapability, boolean>>> & {
    readonly [START_WHILE_ACTIVE_CAPABILITY]: StartWhileActiveMode;
  };

/** Client-wire extension attached to every projected `Thread` in multi-provider mode. */
export interface CodewideAgentThreadExtension {
  /** The provider's declared capability set. */
  readonly capabilities: CapabilitySet;
  /** Whether the provider is the host's primary provider (no badge). */
  readonly primary: boolean;
  /** Provider bound to the thread for its whole life. */
  readonly provider: string;
  /** Human-readable provider name, used only as badge text. */
  readonly providerName: string;
}

/**
 * Reads one capability from an optional client-wire extension. A missing
 * extension means a legacy companion: the thread is Codex with every
 * capability, so the answer is `true`.
 */
export function supportsCapability(
  extension: CodewideAgentThreadExtension | null | undefined,
  name: CapabilityName,
): boolean {
  if (extension === null || extension === undefined) {
    return true;
  }
  const value: boolean | StartWhileActiveMode | undefined = extension.capabilities[name];
  return value === true || value === "busy" || value === "nativeJoin";
}
