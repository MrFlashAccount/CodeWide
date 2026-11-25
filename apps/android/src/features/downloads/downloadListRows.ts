import type { Observable } from "@legendapp/state";

import type { DownloadEntry, DownloadId } from "../../data/downloadRecords";

type DownloadListRow =
  | { readonly key: string; readonly kind: "day"; readonly title: string }
  | { readonly entry$: Observable<DownloadEntry>; readonly key: DownloadId; readonly kind: "file" };

/** Tracks list membership, ordering and active search. File cells observe their own transfer state. */
export function downloadListRows(
  entries$: Observable<readonly DownloadEntry[]>,
  query: string,
  now: number,
): readonly DownloadListRow[] {
  const rows: DownloadListRow[] = [];
  const today = startOfDay(now);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  let previousDay: number | undefined;
  // The sheet observes the count. Read its current value here too, since a removal
  // can notify an item's subscribers before React commits the new count.
  const count = entries$.peek().length;
  for (let i = 0; i < count; i += 1) {
    const entry$ = entries$[i];
    if (
      entry$ === undefined ||
      (query !== "" && !entry$.name.get().toLowerCase().includes(query))
    ) {
      continue;
    }
    const day = startOfDay(entry$.startedAt.get());
    if (day !== previousDay) {
      rows.push({
        key: `day:${String(day)}`,
        kind: "day",
        title: dayTitle(day, today, yesterday.getTime()),
      });
      previousDay = day;
    }
    rows.push({ entry$, key: entry$.id.get(), kind: "file" });
  }
  return rows;
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function dayTitle(day: number, today: number, yesterday: number): string {
  if (day === today) {
    return "Today";
  }
  if (day === yesterday) {
    return "Yesterday";
  }
  return new Date(day).toLocaleDateString(undefined, { day: "numeric", month: "long" });
}
