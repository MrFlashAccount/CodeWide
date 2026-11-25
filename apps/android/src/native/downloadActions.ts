/** Saved files are owned by the Android document provider. */
export async function renameDownload(
  _uri: string,
  _name: string,
): Promise<{ name: string; uri: string }> {
  await Promise.resolve();
  throw new Error("Renaming downloads is available in the Android build");
}

/** The system file chooser is available on Android. */
export async function shareDownloads(
  _uris: readonly string[],
  _mimeType: string | null,
): Promise<void> {
  await Promise.resolve();
  throw new Error("Sharing downloads is available in the Android build");
}
