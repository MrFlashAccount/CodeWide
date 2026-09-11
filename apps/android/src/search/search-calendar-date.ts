/** Compose date pickers represent a calendar day as midnight UTC, not a local instant. */
export function searchDayFromCalendar(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Stored filter days remain date-only; the query adapter applies local timezone bounds. */
export function searchDayToCalendar(value: string): string {
  if (value !== "") return `${value}T00:00:00.000Z`;
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}T00:00:00.000Z`;
}

export function formatSearchDay(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
