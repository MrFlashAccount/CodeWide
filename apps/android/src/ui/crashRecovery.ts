/** Copies a crash report without loading the native clipboard during shell startup. */
export async function copyCrashReport(report: string): Promise<void> {
  const { setStringAsync } = await import("expo-clipboard");
  await setStringAsync(report);
}

/** Reloads a published update when Expo Updates owns the running bundle. */
export async function reloadPublishedApp(): Promise<boolean> {
  const { isEnabled, reloadAsync } = await import("expo-updates");
  if (!isEnabled) {
    return false;
  }
  await reloadAsync();
  return true;
}
