/** Semantic callers of imperative timeline positioning; never contains message content. */
export type TimelineScrollSource =
  | "response-start"
  | "jump-end"
  | "jump-unread"
  | "search-result"
  | "search-restore"
  | "unspecified";

/** Native-independent projection of the list's public measurement API. */
export type TimelineListGeometry = {
  readonly contentHeightPx: number | null;
  readonly firstIndex: number | null;
  readonly isAtEnd: boolean | null;
  readonly lastIndex: number | null;
  readonly offsetY: number | null;
  readonly viewportHeightPx: number | null;
  readonly withinEndThreshold: boolean | null;
};

/** A diagnostic description, not an executable scroll instruction. */
export type TimelineScrollTarget =
  | { readonly kind: "end" }
  | {
      readonly index: number;
      readonly kind: "index";
      readonly viewOffset: number;
      readonly viewPosition: number;
    }
  | { readonly kind: "offset"; readonly offset: number };

/** Only policy switches and opaque turn identity cross the observation boundary. */
export type TimelineScrollPolicy = {
  readonly anchorIndex: number | null;
  readonly anchorReason: "completedResponse" | "initialUnread" | "lateUnread" | "none";
  readonly anchorTurnId: string | null;
  readonly awayFromLatest: boolean;
  readonly containsBeginning: boolean;
  readonly containsLatest: boolean;
  readonly fullscreenCovered: boolean;
  readonly initialScrollAtEnd: boolean;
  readonly jumpRequestId: number | null;
  readonly rowCount: number;
  readonly scrollEnabled: boolean;
  readonly searchActive: boolean;
  readonly timelinePositioned: boolean;
};

/** Discrete observations are retained in addition to rate-limited physical scroll samples. */
export type TimelineScrollObservation =
  | { readonly kind: "lifecycle"; readonly phase: "mounted" | "unmounted" }
  | { readonly kind: "policy"; readonly policy: TimelineScrollPolicy }
  | {
      readonly accepted: boolean;
      readonly anchorIndex: number | null;
      readonly keyMatches: boolean;
      readonly kind: "anchor-ready";
      readonly sizePx: number;
    }
  | {
      readonly kind: "layout";
      readonly sizePx: number;
      readonly source: "viewport" | "content" | "measurement-invalidation" | "content-inset";
    }
  | { readonly kind: "end-threshold"; readonly withinThreshold: boolean }
  | { readonly index: number; readonly kind: "visible-row" }
  | {
      readonly covered: boolean;
      readonly inFlight: boolean;
      readonly kind: "jump";
      readonly pending: boolean;
      readonly phase:
        | "requested"
        | "blocked"
        | "range-ready"
        | "completed"
        | "cancelled"
        | "failed";
      readonly requestId: number;
    };

/** Gesture phases are discrete, while per-frame coordinates stay on the existing scroll path. */
export type TimelineScrollGesture = "drag-start" | "drag-end" | "momentum-start" | "momentum-end";

/** Validated dispatch evidence from the pinned LegendList native adapter; no list data crosses. */
export type TimelineLibraryScrollCommand = {
  readonly animated: boolean;
  readonly contentHeightPx: number;
  readonly initial: boolean;
  readonly initialPending: boolean;
  readonly logicalOffsetPx: number;
  readonly maintainingEnd: boolean;
  readonly nativeCorrectionPending: boolean;
  readonly offsetPx: number;
  readonly phase: "dispatch" | "retry";
  readonly rowCount: number;
  readonly viewportHeightPx: number;
};

/** React-committed MVCP projection, not evidence that native mounting has already applied it. */
export type TimelineLibraryScrollAdjustment = {
  readonly clampCompensationPx: number;
  readonly contentHeightPx: number;
  readonly lastNativeOffsetPx: number | null;
  readonly logicalOffsetPx: number;
  readonly pendingDataAppliedPx: number | null;
  readonly phase: "adjustment";
  readonly requestedDeltaPx: number;
  readonly rowCount: number;
  readonly sentinelDeltaPx: number;
  readonly viewportHeightPx: number;
};

/** Content-free timing emitted by the pinned LegendList adapter around its synchronous JS work. */
export type TimelineLibraryPerformance =
  | {
      readonly dataChanged: boolean;
      readonly doMVCP: boolean;
      readonly durationMs: number;
      readonly forceFullItemPositions: boolean;
      readonly phase: "calculate";
      readonly positionDurationMs: number;
      readonly positionStartIndex: number;
      readonly rowCount: number;
      readonly visibleEndIndex: number;
      readonly visibleStartIndex: number;
    }
  | {
      readonly changedCount: number;
      readonly durationMs: number;
      readonly measurementCount: number;
      readonly needsRecalculate: boolean;
      readonly phase: "size-batch";
      readonly rowCount: number;
    };

/** Content-free row category used to aggregate list measurement behavior. */
export type TimelineRowDiagnosticKind = "item" | "turnLead" | "turnSlice";

/** Bounded fallback categories emitted by the timeline row geometry owner. */
export type TimelineFixedSizeFallbackReason =
  | "composite-row"
  | "inline-review-state"
  | "invalid-geometry"
  | "leading-activity"
  | "markdown-html"
  | "markdown-measurement-error"
  | "markdown-measurement-unavailable"
  | "markdown-table"
  | "markdown-unsupported-node"
  | "performance-experiment"
  | "streaming"
  | "trailing-artifacts"
  | "unsupported-row";

/** Result of the synchronous row geometry lookup performed inside LegendList work. */
export type TimelineFixedSizeDiagnostic =
  | { readonly source: "cache" | "calculated"; readonly status: "exact" }
  | {
      readonly estimate: number;
      readonly reason: TimelineFixedSizeFallbackReason;
      readonly status: "dynamic";
    };
