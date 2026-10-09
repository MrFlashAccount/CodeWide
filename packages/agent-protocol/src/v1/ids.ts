/**
 * Branded identifiers of the `codewide-agent` v1 protocol.
 *
 * Every id is a plain JSON string (or number for native request ids) on the
 * wire. The brand exists only at compile time so that a thread id, a turn id
 * and a provider id with the same runtime representation cannot be swapped
 * by accident. Brands are applied after validation at a trust boundary.
 */

declare const brand: unique symbol;

/** Nominal wrapper over a runtime value; erased on the wire. */
export type Brand<Value, Name extends string> = Value & { readonly [brand]: Name };

/** Provider identity: `"codex"` or `"claude"` in phase 1. The set is open. */
export type ProviderId = Brand<string, "ProviderId">;

/** Companion-owned thread identity shown to clients. */
export type AppThreadId = Brand<string, "AppThreadId">;

/**
 * The provider's own handle for a thread. In phase 1 it always equals the
 * `AppThreadId`; phase 2 lets it diverge after a provider switch.
 */
export type ProviderThreadRef = Brand<string, "ProviderThreadRef">;

/** Turn identity, unique within one thread. */
export type TurnId = Brand<string, "TurnId">;

/** Item identity, unique within one turn. */
export type ItemId = Brand<string, "ItemId">;

/** Client-generated message identity used to reconcile optimistic sends. */
export type ClientMessageId = Brand<string, "ClientMessageId">;

/** Provider-native runtime request id as it appears in the provider protocol. */
export type NativeRequestId = string | number;

/**
 * Companion-side composite identity of a runtime request. Two providers may
 * issue the same native id; the pair is unique.
 */
export interface RuntimeRequestId {
  readonly provider: ProviderId;
  readonly nativeId: NativeRequestId;
}
