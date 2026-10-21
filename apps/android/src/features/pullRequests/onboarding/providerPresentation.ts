/**
 * Presentation policy of provider cards. Known `iconKey`s get a native
 * explanation; every other provider is described by its plugin label and
 * detail. Behavior never branches on the plugin id or forge name.
 */
import type { AuthFlow, AuthMethod, ForgeProvider } from "../../../data/forgeContract";

const EXPLANATIONS: Readonly<Record<string, string>> = {
  // Scopes and method details belong to each method's own line, not the card summary.
  github: "Review GitHub pull requests with the companion host's login. Tokens stay on the host.",
};

/** Order a card offers its methods in: one-tap links first, host steps last. */
const METHOD_ORDER: readonly AuthMethod["kind"][] = [
  "linkExisting",
  "hostLogin",
  "pasteToken",
  "instructions",
];

/** One-paragraph explanation shown under the provider name. */
export function providerExplanation(provider: ForgeProvider): string {
  const known = Object.hasOwn(EXPLANATIONS, provider.icon.iconKey)
    ? EXPLANATIONS[provider.icon.iconKey]
    : undefined;
  // Unknown providers say what they give; the connect step stays in the method itself.
  return known ?? `Review ${provider.forgeName} pull requests through the companion host.`;
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
