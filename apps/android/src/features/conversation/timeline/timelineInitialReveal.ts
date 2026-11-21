import type { ThreadTimelineListRef } from "../../../rendering/ThreadTimelineList";
import { waitForReadingRow } from "../../../rendering/timelineReadingRow";
import type { TimelineResponseStart } from "./timelineResponseStart";

/** Reveals the transcript once the opening target has settled within the usable viewport. */
export async function prepareTimelineOpening({
  anchor,
  bottomInset,
  list,
  offset,
  readingIndex,
  request,
  topInset,
  unreadOpening,
}: Omit<Parameters<TimelineResponseStart["prepareInitialReveal"]>[0], "list"> & {
  readonly list: ThreadTimelineListRef | null;
  readonly readingIndex: { readonly index: number; readonly viewOffset: number } | undefined;
  readonly request: TimelineResponseStart | null;
  readonly unreadOpening: boolean;
}): Promise<void> {
  if (list === null) {
    return;
  }
  if (readingIndex !== undefined) {
    await waitForReadingRow(list, readingIndex, topInset);
    return;
  }
  await request?.prepareInitialReveal({ anchor, bottomInset, list, offset, topInset });
  if (unreadOpening && anchor !== null) {
    await waitForReadingRow(list, null, topInset);
  }
}
