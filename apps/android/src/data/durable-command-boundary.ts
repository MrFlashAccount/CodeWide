/**
 * Crosses the only durable acceptance boundary for a client command.
 *
 * A native failure rejects and lets the chat model roll the optimistic mutation
 * back. Once Kotlin has accepted the command, the UI projection is merely a
 * reconstructable read model: its failure must never turn an accepted command
 * into a user-visible send failure or invite a duplicate retry.
 */
export async function commitNativeThenProject<T>(
  persistNative: () => Promise<T>,
  projectUi: (accepted: T) => Promise<unknown>,
  onProjectionError: (cause: unknown) => void = (cause) => {
    console.error("Accepted native command could not be projected immediately", cause);
  },
): Promise<T> {
  const accepted = await persistNative();
  try {
    await projectUi(accepted);
  } catch (cause) {
    onProjectionError(cause);
  }
  return accepted;
}
