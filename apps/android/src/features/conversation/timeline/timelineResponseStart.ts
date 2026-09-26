import type { LegendListProps } from "@legendapp/list/react-native";
import type { TimelineScrollDiagnostics } from "../../../data/timelineScrollDiagnostics";
import type { ThreadTimelineListRef } from "../../../rendering/ThreadTimelineList";

type Anchor = { readonly index: number; readonly key: string };
type AnchorSpace = NonNullable<LegendListProps<unknown>["anchoredEndSpace"]>;

/** One response-positioning intent; repeated measurements cannot reapply it. */
export class TimelineResponseStart {
  private pending = true;
  readonly reason: "completedResponse" | "initialUnread";
  readonly turnId: string;

  constructor(reason: "completedResponse" | "initialUnread", turnId: string) {
    this.reason = reason;
    this.turnId = turnId;
  }

  /** A manual gesture permanently revokes this intent, including retained readiness callbacks. */
  cancel(): void {
    this.pending = false;
  }

  /** Binds readiness to this exact intent, rather than a later React render's handler. */
  anchorSpace({
    anchor,
    diagnostics,
    getList,
    offset,
  }: {
    readonly anchor: Anchor | null;
    readonly diagnostics: TimelineScrollDiagnostics;
    readonly getList: () => Pick<ThreadTimelineListRef, "indexForItemKey" | "scrollToIndex"> | null;
    readonly offset: number;
  }): AnchorSpace | undefined {
    if (anchor === null) {
      return undefined;
    }
    return {
      anchorIndex: anchor.index,
      anchorOffset: offset,
      // This is an intent-bound capability, not a latest-render callback. LegendList calls it
      // from a child layout effect, before a parent's useEvent implementation has committed.
      onReady: ({ anchorIndex, anchorKey, size }) => {
        const list = getList();
        const keyMatches = anchorKey === anchor.key;
        const accepted =
          this.pending &&
          keyMatches &&
          anchorIndex === anchor.index &&
          list !== null &&
          list.indexForItemKey(anchor.key) === anchor.index;
        diagnostics.record({
          accepted,
          anchorIndex: anchorIndex ?? null,
          keyMatches,
          kind: "anchor-ready",
          sizePx: size,
        });
        if (!accepted) {
          return;
        }
        this.pending = false;
        void list
          .scrollToIndex(
            { animated: false, index: anchor.index, viewOffset: offset, viewPosition: 0 },
            "response-start",
          )
          .catch(() => undefined);
      },
    };
  }
}
