export const PROVIDERS_VIEW = "providers";
export const PROVIDER_ONBOARDING_STEP_COUNT = 4;
export const PROVIDER_STEP = 1;
export const METHOD_STEP = 2;
export const AUTHENTICATION_STEP = 3;
export const SUCCESS_STEP = 4;

export type ProviderOnboardingStep =
  | typeof PROVIDER_STEP
  | typeof METHOD_STEP
  | typeof AUTHENTICATION_STEP
  | typeof SUCCESS_STEP;

export function providerMethodsView(pluginId: string): string {
  return `provider:${pluginId}:methods`;
}

export function providerAuthView(pluginId: string): string {
  return `provider:${pluginId}:auth`;
}

export function providerSuccessView(pluginId: string): string {
  return `provider:${pluginId}:success`;
}
