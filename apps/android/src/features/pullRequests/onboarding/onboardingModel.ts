/**
 * Pending connect interactions per provider card. The live flow itself is
 * companion-owned and re-read from the accounts resource; this model holds only
 * what the device is waiting for and the last error the user must see.
 */
import { observable } from "@legendapp/state";

/** What a provider card is waiting for. */
export type ProviderPending = "cancelling" | "checking" | "starting" | null;

type ProviderInteraction = { readonly error: string | null; readonly pending: ProviderPending };

const IDLE: ProviderInteraction = { error: null, pending: null };

/** Interaction state keyed by `connectionId\0pluginId`. */
export const onboardingModel = observable<Record<string, ProviderInteraction>>({});

/** Stable key of one provider card on one connection. */
export function providerInteractionKey(connectionId: string, pluginId: string): string {
  return `${connectionId}\u0000${pluginId}`;
}

/** An absent entry is an idle card. */
export function providerInteractionState(
  value: ProviderInteraction | undefined,
): ProviderInteraction {
  return value ?? IDLE;
}

/** Reads the interaction of one card without subscribing. */
function providerInteraction(key: string): ProviderInteraction {
  return onboardingModel[key]?.peek() ?? IDLE;
}

/**
 * Starts one card operation with its pending state; a second start while one
 * is pending is ignored. The error shown is the companion's short reason; a
 * success clears it. The outcome lands in the model, so callers do not await it.
 */
export function startProviderInteraction(
  key: string,
  pending: Exclude<ProviderPending, null>,
  operation: () => Promise<unknown>,
): void {
  if (providerInteraction(key).pending !== null) {
    return;
  }
  onboardingModel[key]?.set({ error: null, pending });
  operation().then(
    () => {
      onboardingModel[key]?.set(IDLE);
    },
    (error: unknown) => {
      onboardingModel[key]?.set({
        error: error instanceof Error ? error.message : "Could not connect the account",
        pending: null,
      });
    },
  );
}
