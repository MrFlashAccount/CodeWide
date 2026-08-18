export type RecoverableRenderScope = "bubble" | "dialog" | "surface";

export type RecoverableRenderFailure = {
  scope: RecoverableRenderScope;
  label: string;
  error: Error;
  componentStack: string;
  context?: string;
};

const MAX_ERROR_STACK_CHARS = 8_000;
const MAX_COMPONENT_STACK_CHARS = 8_000;
const MAX_CONTEXT_CHARS = 2_000;

function bounded(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n…truncated`;
}

export function renderRecoveryPrompt(failure: RecoverableRenderFailure): string {
  const context = failure.context?.trim();
  return [
    "Fix a localized render crash in the CodeWide Android client.",
    `Surface: ${failure.scope} / ${failure.label}`,
    ...(context === undefined || context === "" ? [] : [`Context:\n${bounded(context, MAX_CONTEXT_CHARS)}`]),
    `Error:\n${failure.error.message || "Unknown React render error"}`,
    `JavaScript stack:\n${bounded(failure.error.stack ?? "Unavailable", MAX_ERROR_STACK_CHARS)}`,
    `React component stack:\n${bounded(failure.componentStack || "Unavailable", MAX_COMPONENT_STACK_CHARS)}`,
    "Find the systemic cause, keep the failure isolated to this surface, add a regression test, and do not remove the error boundary.",
  ].join("\n\n");
}
