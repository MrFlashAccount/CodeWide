export async function restartApplication(): Promise<void> {
  globalThis.location.reload();
}
