import { NativeModules, Platform } from "react-native";

import { formatTimeForDevice, type DeviceTimePreferences } from "./device-time-format";

type NativeTimeConfiguration = {
  localeTag?: unknown;
  uses24HourClock?: unknown;
};

export function formatDeviceTime(timestampSeconds: number, preferences = readDeviceTimePreferences()): string {
  return formatTimeForDevice(timestampSeconds, preferences);
}

export function readDeviceTimePreferences(): DeviceTimePreferences {
  if (Platform.OS !== "android") return {};
  const configuration = NativeModules.CodeWideNative as NativeTimeConfiguration | undefined;
  const locale = typeof configuration?.localeTag === "string" && configuration.localeTag !== ""
    ? configuration.localeTag
    : undefined;
  const uses24HourClock = typeof configuration?.uses24HourClock === "boolean"
    ? configuration.uses24HourClock
    : undefined;
  return {
    ...(locale === undefined ? {} : { locale }),
    ...(uses24HourClock === undefined ? {} : { uses24HourClock }),
  };
}
