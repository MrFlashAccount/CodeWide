const MAX_ACTION_ERROR_LENGTH = 320;

/** Keeps an actionable failure exact when possible and bounded for a UI surface. */
export function actionFailure(cause: unknown, fallback: string): string {
  const message =
    cause instanceof Error && cause.message !== ""
      ? cause.message
      : typeof cause === "string" && cause !== ""
        ? cause
        : fallback;
  if (message.length <= MAX_ACTION_ERROR_LENGTH) return message;
  return `${message.slice(0, MAX_ACTION_ERROR_LENGTH - 1)}…`;
}
