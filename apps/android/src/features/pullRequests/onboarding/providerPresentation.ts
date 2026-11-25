/**
 * Presentation policy of provider cards. Every provider gets the same
 * explanation built from its declared forge name; method labels and details
 * come from the plugin. Behavior never branches on the plugin id, forge name
 * or icon.
 */
import type { AuthFlow, AuthMethod, ForgeProvider } from "../../../data/forgeContract";

/** Order a card offers its methods in: one-tap links first, host steps last. */
const METHOD_ORDER: readonly AuthMethod["kind"][] = [
  "linkExisting",
  "hostLogin",
  "pasteToken",
  "instructions",
];

/** One-paragraph explanation shown under the provider name; scopes and steps belong to each method. */
export function providerExplanation(provider: ForgeProvider): string {
  return `Review ${provider.forgeName} pull requests with the companion host's login. Tokens stay on the host.`;
}

/** Account-purpose methods in the order the card offers them. */
export function accountMethods(provider: ForgeProvider): readonly AuthMethod[] {
  return provider.authMethods
    .filter((method) => method.purpose === "account")
    .sort((left, right) => METHOD_ORDER.indexOf(left.kind) - METHOD_ORDER.indexOf(right.kind));
}

/** The live host-login flow of a provider, if any. */
export function activeFlow(provider: ForgeProvider, flows: readonly AuthFlow[]): AuthFlow | null {
  return flows.find((candidate) => candidate.pluginId === provider.pluginId) ?? null;
}
