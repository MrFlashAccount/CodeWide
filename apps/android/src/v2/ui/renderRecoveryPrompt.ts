export type RecoverableRenderScope = "bubble" | "dialog" | "surface";

export interface RecoverableRenderFailure {
  componentStack: string;
  context?: string;
  error: Error;
  label: string;
  scope: RecoverableRenderScope;
}

const MAX_ERROR_STACK_CHARS = 8000;
const MAX_COMPONENT_STACK_CHARS = 8000;
const MAX_CONTEXT_CHARS = 2000;

export function renderRecoveryPrompt(failure: RecoverableRenderFailure): string {
  const context = failure.context?.trim();
  return [
    "Fix a localized render crash in the CodeWide V2 Android client.",
    `Surface: ${failure.scope} / ${failure.label}`,
    ...(context === undefined || context === ""
      ? []
      : [`Context:\n${bounded(context, MAX_CONTEXT_CHARS)}`]),
    `Error:\n${failure.error.message === "" ? "Unknown React render error" : failure.error.message}`,
    `JavaScript stack:\n${bounded(failure.error.stack ?? "Unavailable", MAX_ERROR_STACK_CHARS)}`,
    `React component stack:\n${bounded(failure.componentStack === "" ? "Unavailable" : failure.componentStack, MAX_COMPONENT_STACK_CHARS)}`,
    "Find the systemic cause, keep the failure isolated to this surface, add a regression test, and do not remove the error boundary.",
  ].join("\n\n");
}

function bounded(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n…truncated`;
}
