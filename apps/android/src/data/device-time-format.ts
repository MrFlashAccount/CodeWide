export type DeviceTimePreferences = {
  locale?: string;
  uses24HourClock?: boolean;
};

const deviceTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function deviceTimeFormatter(preferences: DeviceTimePreferences): Intl.DateTimeFormat {
  const locale = preferences.locale ?? "";
  const hourMode = preferences.uses24HourClock === undefined
    ? "device"
    : preferences.uses24HourClock ? "24" : "12";
  const key = `${locale}\u0000${hourMode}`;
  const cached = deviceTimeFormatters.get(key);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DateTimeFormat(preferences.locale, {
    hour: "2-digit",
    minute: "2-digit",
    ...(preferences.uses24HourClock === undefined ? {} : { hour12: !preferences.uses24HourClock }),
  });
  deviceTimeFormatters.set(key, formatter);
  return formatter;
}

export function formatTimeForDevice(timestampSeconds: number, preferences: DeviceTimePreferences): string {
  return deviceTimeFormatter(preferences).format(timestampSeconds * 1_000);
}
