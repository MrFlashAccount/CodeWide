/**
 * Validated client view of the Companion's per-thread agent descriptor.
 *
 * A multi-provider Companion attaches `Thread.codewideAgent` (`provider`,
 * `providerName`, `primary`, `capabilities`; see `CodewideAgentThreadExtension` in
 * `packages/agent-protocol`) to every thread it projects. The provider is fixed for
 * a thread's life and the capability set decides which features the client
 * offers. A thread without a descriptor comes from a legacy or single-provider
 * Companion: it is a Codex thread with every capability, so `null` is the only
 * legacy representation and grants everything. A descriptor that is present
 * but malformed is not legacy: it reads as an agent with no capabilities (and
 * an unknown provider when its id is unusable), and is logged once.
 *
 * Clients never branch on provider ids or names to decide features; the id only
 * keeps catalog rows of one provider together and the name is badge text.
 */
import { appLogger } from "../observability/logger";
import { unknownRecord } from "./unknownRecord";

declare const agentProviderIdBrand: unique symbol;

/** Opaque provider identity reported by the Companion, e.g. a thread's bound agent. */
export type AgentProviderId = string & { readonly [agentProviderIdBrand]: true };

/**
 * Capability names whose absence hides or disables a client control. The full
 * vocabulary is owned by the Companion protocol; this list is the subset the
 * client consumes.
 */
export type ThreadAgentCapability =
  | "accounts.rateLimits"
  | "backgroundTerminals"
  | "catalog.skillsPlugins"
  | "goals"
  | "history.threadResources"
  | "input.skillsAndMentions"
  | "review"
  | "threads.compact"
  | "threads.crossProviderFork"
  | "threads.fork";

/** Persistable descriptor: the bound provider and its supported capability names. */
export type ThreadAgent = {
  readonly capabilities: readonly string[];
  /** Whether the provider is the host's primary provider; only non-primary threads get a badge. */
  readonly primary: boolean;
  /** `null` only for a malformed descriptor whose provider id is unusable. */
  readonly provider: AgentProviderId | null;
  /** Human-readable provider name, used only as badge text. */
  readonly providerName: string;
};

const MAX_PROVIDER_ID_CHARACTERS = 64;
const MAX_CAPABILITY_CHARACTERS = 128;
const MAX_CAPABILITIES = 256;
const MAX_PROVIDER_NAME_CHARACTERS = 64;

/** Validates one external provider identity; returns `null` for any other shape. */
export function parseAgentProviderId(value: unknown): AgentProviderId | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PROVIDER_ID_CHARACTERS ||
    value.trim() !== value
  ) {
    return null;
  }
  // WHY: Validation above proves a bounded non-empty provider identifier; the brand has no runtime representation.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as AgentProviderId;
}

/**
 * Reads a thread-like value's `codewideAgent` extension. Capabilities are a record
 * whose supported entries are `true` or a mode such as `"busy"`; a list of
 * supported names is accepted too. Unknown or `false` entries are unsupported.
 * A descriptor without `primary` is treated as primary (no badge) and one without
 * a usable `providerName` shows its provider id. Returns `null` (legacy: Codex
 * with every capability) only when the descriptor is absent (or `null`); a
 * malformed descriptor yields an agent without capabilities.
 */
export function readThreadAgent(thread: unknown): ThreadAgent | null {
  const raw: unknown = unknownRecord(thread)?.codewideAgent;
  if (raw === undefined || raw === null) {
    return null;
  }
  const descriptor = unknownRecord(raw);
  return declaredThreadAgent(descriptor) ?? malformedThreadAgent(descriptor);
}

function declaredThreadAgent(descriptor: Record<string, unknown> | null): ThreadAgent | null {
  if (descriptor === null) {
    return null;
  }
  const provider = parseAgentProviderId(descriptor.provider);
  const capabilities = supportedCapabilityNames(descriptor.capabilities);
  if (provider === null || capabilities === null) {
    return null;
  }
  return {
    capabilities,
    primary: descriptor.primary !== false,
    provider,
    providerName: providerDisplayName(descriptor.providerName) ?? provider,
  };
}

function malformedThreadAgent(descriptor: Record<string, unknown> | null): ThreadAgent {
  reportMalformedDescriptor();
  const provider = parseAgentProviderId(descriptor?.provider);
  return {
    capabilities: [],
    primary: descriptor?.primary !== false,
    provider,
    providerName: providerDisplayName(descriptor?.providerName) ?? provider ?? "Agent",
  };
}

let malformedDescriptorReported = false;

/** Descriptors are read on every render and projection; one diagnostic per process is enough. */
function reportMalformedDescriptor(): void {
  if (malformedDescriptorReported) {
    return;
  }
  malformedDescriptorReported = true;
  appLogger.warn({ event: "thread_agent.descriptor.malformed" });
}

/** Reads a descriptor previously persisted by this client; same contract as the wire. */
export function normalizeStoredThreadAgent(value: unknown): ThreadAgent | null {
  return readThreadAgent({ codewideAgent: value });
}

/** A legacy descriptor (`null`) supports every capability. */
export function threadAgentSupports(
  agent: ThreadAgent | null,
  capability: ThreadAgentCapability,
): boolean {
  return agent === null || agent.capabilities.includes(capability);
}

/**
 * Whether the thread's agent explicitly declares `capability`. Unlike
 * `threadAgentSupports`, a legacy thread (`null`) declares nothing: use this for
 * capabilities that only a multi-provider Companion can offer, such as
 * `threads.crossProviderFork`.
 */
export function threadAgentDeclares(
  agent: ThreadAgent | null,
  capability: ThreadAgentCapability,
): boolean {
  return agent !== null && agent.capabilities.includes(capability);
}

/** Returns `capability` only when the thread's agent declares the matching capability. */
export function whenThreadAgentSupports<Value>(
  agent: ThreadAgent | null,
  capability: ThreadAgentCapability,
  value: Value | undefined,
): Value | undefined {
  return threadAgentSupports(agent, capability) ? value : undefined;
}

/** Equality used by summary change detection; capability order is preserved from the wire. */
export function sameThreadAgent(left: ThreadAgent | null, right: ThreadAgent | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return (
    left.provider === right.provider &&
    left.primary === right.primary &&
    left.providerName === right.providerName &&
    left.capabilities.length === right.capabilities.length &&
    left.capabilities.every((capability, index) => capability === right.capabilities[index])
  );
}

function supportedCapabilityNames(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    return boundedNames(value.filter(isCapabilityName));
  }
  const record = unknownRecord(value);
  if (record === null) {
    return null;
  }
  const names: string[] = [];
  for (const [name, declared] of Object.entries(record)) {
    if (isCapabilityName(name) && declaresSupport(declared)) {
      names.push(name);
    }
  }
  return boundedNames(names);
}

function providerDisplayName(value: unknown): string | null {
  return typeof value === "string" &&
    value.trim() !== "" &&
    value.length <= MAX_PROVIDER_NAME_CHARACTERS
    ? value.trim()
    : null;
}

function boundedNames(names: string[]): string[] | null {
  return names.length > MAX_CAPABILITIES ? null : names;
}

function isCapabilityName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_CAPABILITY_CHARACTERS;
}

function declaresSupport(value: unknown): boolean {
  return value === true || (typeof value === "string" && value !== "");
}
