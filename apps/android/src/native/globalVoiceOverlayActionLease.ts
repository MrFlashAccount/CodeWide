let activeToken: string | null = null;

/** Admits overlay actions only while their originating foreground lease is alive. */
export function activateGlobalVoiceOverlayActions(token: string): void {
  activeToken = token;
}

/** Fences queued native callbacks before foreground cleanup begins. */
export function releaseGlobalVoiceOverlayActions(token: string): void {
  if (activeToken === token) {
    activeToken = null;
  }
}

/** Validates the native event's lease instead of targeting whichever session is current later. */
export function acceptsGlobalVoiceOverlayAction(value: unknown): boolean {
  return (
    activeToken !== null &&
    value !== null &&
    typeof value === "object" &&
    "token" in value &&
    value.token === activeToken
  );
}
