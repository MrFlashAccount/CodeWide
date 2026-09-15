export type TimelineInitialPosition =
  | { kind: "tail" }
  | { kind: "item"; index: number; viewOffset?: number; viewPosition?: number };

export type LegendInitialPositionProps =
  | { initialScrollAtEnd: true }
  | { initialScrollIndex: { index: number; viewOffset?: number; viewPosition?: number } };

/** LegendList requires its two initial-position modes to be mutually exclusive. */
export function legendInitialPositionProps(
  position: TimelineInitialPosition,
): LegendInitialPositionProps {
  if (position.kind === "tail") return { initialScrollAtEnd: true };
  return {
    initialScrollIndex: {
      index: position.index,
      ...(position.viewOffset === undefined ? {} : { viewOffset: position.viewOffset }),
      ...(position.viewPosition === undefined ? {} : { viewPosition: position.viewPosition }),
    },
  };
}
