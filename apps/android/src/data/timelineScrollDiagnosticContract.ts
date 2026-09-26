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
  readonly anchorReason: "completedResponse" | "initialUnread" | "none";
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
