import type { LegendListProps } from "@legendapp/list/react-native";
import type { TimelineScrollDiagnostics } from "../../../data/timelineScrollDiagnostics";
import type { ThreadTimelineListRef } from "../../../rendering/ThreadTimelineList";

type Anchor = { readonly index: number; readonly key: string };
type AnchorSpace = NonNullable<LegendListProps<unknown>["anchoredEndSpace"]>;
type ResponseList = Pick<
  ThreadTimelineListRef,
  "indexForItemKey" | "measureItemViewport" | "scrollToIndex"
>;
type ResponseStartState =
  | { readonly reason: "initialUnread"; readonly status: "initial" | "cancelled" }
  | {
      readonly reason: "completedResponse" | "lateUnread";
      readonly status: "pending" | "measuring" | "settled";
    };

/** One response-positioning intent; repeated measurements cannot reapply it. */
export class TimelineResponseStart {
  private state: ResponseStartState;
  readonly turnId: string;

  constructor(reason: TimelineResponseStart["reason"], turnId: string) {
    this.state =
      reason === "initialUnread" ? { reason, status: "initial" } : { reason, status: "pending" };
    this.turnId = turnId;
  }

  /** Distinguishes bootstrap ownership from one-shot positioning after the list has opened. */
  get reason(): ResponseStartState["reason"] {
    return this.state.reason;
  }

  /** Bootstrap clamps to the natural tail when the unread start already fits in the viewport. */
  initialPosition(
    anchor: Anchor | null,
    offset: number,
  ): { readonly index: number; readonly viewOffset: number; readonly viewPosition: 0 } | undefined {
    return this.state.status === "initial" && anchor !== null
      ? { index: anchor.index, viewOffset: offset, viewPosition: 0 }
      : undefined;
  }

  /** A manual gesture permanently revokes this intent, including retained readiness callbacks. */
  cancel(): void {
    const { reason } = this.state;
    this.state =
      reason === "initialUnread" ? { reason, status: "cancelled" } : { reason, status: "settled" };
  }

  /** Binds readiness to this exact intent, rather than a later React render's handler. */
  anchorSpace({
    anchor,
    bottomInset,
    diagnostics,
    getList,
    maxViewportHeight,
    offset,
    topInset,
  }: {
    readonly anchor: Anchor | null;
    readonly bottomInset: number;
    readonly diagnostics: TimelineScrollDiagnostics;
    readonly getList: () => ResponseList | null;
    readonly maxViewportHeight: number;
    readonly offset: number;
    readonly topInset: number;
  }): AnchorSpace | undefined {
    if (anchor === null) {
      return undefined;
    }
    return {
      anchorIndex: anchor.index,
      // Do not synthesize bottom runway. A short answer that already fits stays at the natural
      // tail; a long row or sliced answer has enough real content to place its start at the top.
      anchorOffset: maxViewportHeight,
      // This is an intent-bound capability, not a latest-render callback. LegendList calls it
      // from a child layout effect, before a parent's useEvent implementation has committed.
      onReady: ({ anchorIndex, anchorKey, size }) => {
        const list = getList();
        const state = this.state;
        const keyMatches = anchorKey === anchor.key;
        // Initial unread positioning belongs to the list's bootstrap, even after onLoad.
        // An imperative command here would supersede bootstrap and reveal unsettled rows.
        const accepted =
          state.status === "pending" &&
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
        this.state = { reason: state.reason, status: "measuring" };
        void this.revealStart({ anchor, bottomInset, getList, list, offset, topInset }).catch(
          () => undefined,
        );
      },
    };
  }

  private async revealStart({
    anchor,
    bottomInset,
    getList,
    list,
    offset,
    topInset,
  }: {
    readonly anchor: Anchor;
    readonly bottomInset: number;
    readonly getList: () => ResponseList | null;
    readonly list: ResponseList;
    readonly offset: number;
    readonly topInset: number;
  }): Promise<void> {
    const viewport = await list.measureItemViewport(anchor.key);
    if (this.state.status !== "measuring") {
      return;
    }
    this.cancel();
    if (getList() !== list || list.indexForItemKey(anchor.key) !== anchor.index) {
      return;
    }
    if (
      viewport.status === "measured" &&
      viewport.top >= topInset &&
      viewport.top < viewport.height - bottomInset
    ) {
      return;
    }
    await list.scrollToIndex(
      { animated: false, index: anchor.index, viewOffset: offset, viewPosition: 0 },
      "response-start",
    );
  }
}
