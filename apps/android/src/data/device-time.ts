import { NativeModules, Platform } from "react-native";
import { unknownRecord } from "./unknownRecord";

import {
  formatDateTimeForDevice,
  formatTimeForDevice,
  type DeviceTimePreferences,
} from "./device-time-format";

export function formatDeviceTime(
  timestampSeconds: number,
  preferences = readDeviceTimePreferences(),
): string {
  return formatTimeForDevice(timestampSeconds, preferences);
}

export function formatDeviceDateTime(
  timestampSeconds: number,
  preferences = readDeviceTimePreferences(),
): string {
  return formatDateTimeForDevice(timestampSeconds, preferences);
}

/** Reads the device locale and explicit 12/24-hour clock preference. */
export function readDeviceTimePreferences(): DeviceTimePreferences {
  if (Platform.OS !== "android") {
    return {};
  }
  const configuration = unknownRecord(NativeModules.CodeWideNative);
  const locale =
    typeof configuration?.localeTag === "string" && configuration.localeTag !== ""
      ? configuration.localeTag
      : undefined;
  const uses24HourClock =
    typeof configuration?.uses24HourClock === "boolean" ? configuration.uses24HourClock : undefined;
  return {
    ...(locale === undefined ? {} : { locale }),
    ...(uses24HourClock === undefined ? {} : { uses24HourClock }),
  };
}

export function formatClockTime(timestamp: number): string {
  return formatDeviceTime(timestamp);
}
