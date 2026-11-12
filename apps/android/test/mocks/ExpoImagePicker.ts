// WHY: expo-image-picker resolves its native module at import; Node render tests have no native
// runtime. Suites that exercise photo capture replace these with their own jest.mock implementations.
export async function launchCameraAsync(): Promise<{ assets: null; canceled: true }> {
  await Promise.resolve();
  return { assets: null, canceled: true };
}

export async function launchImageLibraryAsync(): Promise<{ assets: null; canceled: true }> {
  await Promise.resolve();
  return { assets: null, canceled: true };
}

export async function requestCameraPermissionsAsync(): Promise<{
  canAskAgain: boolean;
  granted: boolean;
}> {
  await Promise.resolve();
  return { canAskAgain: true, granted: false };
}
