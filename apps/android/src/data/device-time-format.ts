export type DeviceTimePreferences = {
  locale?: string;
  uses24HourClock?: boolean;
};

export function formatTimeForDevice(timestampSeconds: number, preferences: DeviceTimePreferences): string {
  return new Date(timestampSeconds * 1_000).toLocaleTimeString(preferences.locale, {
    hour: "2-digit",
    minute: "2-digit",
    ...(preferences.uses24HourClock === undefined ? {} : { hour12: !preferences.uses24HourClock }),
  });
}
