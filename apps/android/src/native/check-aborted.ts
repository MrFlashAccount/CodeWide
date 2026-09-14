/** React Native's AbortSignal has `aborted`, but not `throwIfAborted`.
 * Keep cancellation independent of browser-only convenience methods. */
export function checkAborted(signal: Pick<AbortSignal, "aborted">): void {
  if (!signal.aborted) return;
  const error = new Error("Operation aborted");
  error.name = "AbortError";
  throw error;
}
