import { formatTimeForDevice, type DeviceTimePreferences } from "../../data/device-time-format";

const DAYS_IN_RECENT_WEEK = 7;
const HOURS_PER_DAY = 24;
const MILLISECONDS_PER_SECOND = 1000;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const TWO_DIGITS = 2;
const YEARS_PER_CENTURY = 100;
const MILLISECONDS_PER_DAY =
  HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;

const monthDayFormatters = new Map<string, Intl.DateTimeFormat>();
const weekdayFormatters = new Map<string, Intl.DateTimeFormat>();

/** Formats a thread timestamp using the compact calendar hierarchy of the thread list. */
export function formatThreadRecency(
  timestampSeconds: number,
  preferences: DeviceTimePreferences,
  nowTimestampSeconds = Date.now() / MILLISECONDS_PER_SECOND,
): string {
  const timestamp = new Date(timestampSeconds * MILLISECONDS_PER_SECOND);
  const now = new Date(nowTimestampSeconds * MILLISECONDS_PER_SECOND);
  const ageInCalendarDays = calendarDayOrdinal(now) - calendarDayOrdinal(timestamp);
  if (ageInCalendarDays === 0) {
    return formatTimeForDevice(timestampSeconds, preferences);
  }
  if (ageInCalendarDays > 0 && ageInCalendarDays < DAYS_IN_RECENT_WEEK) {
    return weekdayFormatter(preferences).format(timestamp);
  }
  if (timestamp.getFullYear() === now.getFullYear()) {
    return monthDayFormatter(preferences).format(timestamp);
  }
  return shortNumericDate(timestamp);
}

function calendarDayOrdinal(value: Date): number {
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / MILLISECONDS_PER_DAY;
}

function weekdayFormatter(preferences: DeviceTimePreferences): Intl.DateTimeFormat {
  const key = preferences.locale ?? "";
  const cached = weekdayFormatters.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat(preferences.locale, { weekday: "short" });
  weekdayFormatters.set(key, formatter);
  return formatter;
}

function monthDayFormatter(preferences: DeviceTimePreferences): Intl.DateTimeFormat {
  const key = preferences.locale ?? "";
  const cached = monthDayFormatters.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat(preferences.locale, {
    day: "numeric",
    month: "short",
  });
  monthDayFormatters.set(key, formatter);
  return formatter;
}

function shortNumericDate(value: Date): string {
  const day = String(value.getDate()).padStart(TWO_DIGITS, "0");
  const month = String(value.getMonth() + 1).padStart(TWO_DIGITS, "0");
  const year = String(value.getFullYear() % YEARS_PER_CENTURY).padStart(TWO_DIGITS, "0");
  return `${day}.${month}.${year}`;
}
