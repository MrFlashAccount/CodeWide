export const APP_LOCK_PREFERENCE_ID = "app-lock";

export type AppLockPreferences = {
  enabled: boolean;
};

export const DEFAULT_APP_LOCK_PREFERENCES: AppLockPreferences = {
  enabled: false,
};

export function decodeAppLockPreferences(value: string | null | undefined): AppLockPreferences {
  if (value === null || value === undefined) return DEFAULT_APP_LOCK_PREFERENCES;
  try {
    const candidate: unknown = JSON.parse(value);
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
      return DEFAULT_APP_LOCK_PREFERENCES;
    }
    return { enabled: (candidate as Record<string, unknown>).enabled === true };
  } catch {
    return DEFAULT_APP_LOCK_PREFERENCES;
  }
}

export function encodeAppLockPreferences(preferences: AppLockPreferences): string {
  return JSON.stringify({ enabled: preferences.enabled });
}
