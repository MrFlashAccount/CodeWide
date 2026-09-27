/** React Native's AbortSignal lacks throwIfAborted; check before each activation side effect. */
export function assertVoiceStartActive(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new Error("Global Voice replacement cancelled");
  }
}
