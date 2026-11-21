import { fileExtension, fileMediaKind } from "@codewide/file-types";

import type { DownloadEntry } from "../../data/downloadRecords";
import type { ComposeIconName } from "../../presentation/icons/composeIconNames";
import { formatByteSize } from "../../ui/number-format";

const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "webm", "mkv", "avi"]);
const DAY_MS = 86_400_000;

export type DownloadSection = {
  readonly entries: readonly DownloadEntry[];
  readonly title: string;
};

/** The status line under a download's name. */
export function downloadDescription(entry: DownloadEntry): string {
  const { state } = entry;
  if (state.status === "running") {
    return state.phase === "verifying"
      ? `Verifying · ${formatByteSize(state.transferredBytes)}`
      : byteProgress(state.transferredBytes, state.totalBytes);
  }
  if (state.status === "paused") {
    return `Paused · ${byteProgress(state.transferredBytes, state.totalBytes)}`;
  }
  if (state.status === "completed") {
    return formatByteSize(state.bytes);
  }
  if (state.status === "failed") {
    return `Failed · ${state.error}`;
  }
  if (state.status === "cancelled") {
    return "Cancelled";
  }
  return `Interrupted · ${byteProgress(state.transferredBytes, state.totalBytes)}`;
}

/** Progress 0..1 of an unfinished download, or `null` when its size is unknown. */
export function downloadProgress(entry: DownloadEntry): number | null {
  const { state } = entry;
  if (state.status !== "running" && state.status !== "paused") {
    return null;
  }
  return state.totalBytes === null || state.totalBytes === 0
    ? null
    : Math.min(1, state.transferredBytes / state.totalBytes);
}

export function downloadIcon(name: string): ComposeIconName {
  const media = fileMediaKind(name);
  if (media === "image") {
    return "image-outline";
  }
  if (media === "audio") {
    return "musical-note-outline";
  }
  return VIDEO_EXTENSIONS.has(fileExtension(name).toLowerCase())
    ? "videocam-outline"
    : "document-outline";
}

/** Groups newest-first entries by the calendar day they started, as Chrome's list does. */
export function downloadSections(
  entries: readonly DownloadEntry[],
  now: number,
): readonly DownloadSection[] {
  const sections: { entries: DownloadEntry[]; title: string }[] = [];
  const today = startOfDay(now);
  for (const entry of entries) {
    const title = dayTitle(startOfDay(entry.startedAt), today);
    const last = sections.at(-1);
    if (last?.title === title) {
      last.entries.push(entry);
    } else {
      sections.push({ entries: [entry], title });
    }
  }
  return sections;
}

function byteProgress(transferred: number, total: number | null): string {
  return total === null
    ? formatByteSize(transferred)
    : `${formatByteSize(transferred)} of ${formatByteSize(total)}`;
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function dayTitle(day: number, today: number): string {
  if (day === today) {
    return "Today";
  }
  if (day === today - DAY_MS) {
    return "Yesterday";
  }
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long" }).format(day);
}
