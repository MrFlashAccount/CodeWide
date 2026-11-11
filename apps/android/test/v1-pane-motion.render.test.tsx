import { act, fireEvent, render } from "@testing-library/react-native";
import { StyleSheet, Text, View } from "react-native";
import * as Reanimated from "react-native-reanimated";

import { ConversationEmptyState } from "../src/features/conversation/ConversationEmptyState";
import { ThreadListHeaderRow } from "../src/presentation/navigation/ThreadListHeader";
import {
  catalogFrame,
  centerClipFrame,
  centerContentFrame,
  currentChromeInset,
  destinationFrame,
  rightFrame,
} from "../src/routeComposition/paneFrames";
import {
  interpolatePaneGeometry,
  paneGeometry,
  sidebarWidth,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  type PaneArrangement,
  type PaneGeometry,
} from "../src/routeComposition/paneGeometry";
import {
  movingPaneGeometry,
  startPaneMotion,
  type PaneMotionState,
} from "../src/routeComposition/paneMotion";
import { COVERED_CATALOG_OPACITY } from "../src/routeComposition/paneMotionSpec";
import { WorkspaceCenterLayout } from "../src/routeComposition/WorkspaceCenterLayout";
import { WorkspacePaneFrame } from "../src/routeComposition/WorkspacePaneFrame";
import { colors, radii } from "../src/theme";
import { MessageListBoundary } from "../src/ui/MessageListBoundary";
import { SurfaceToneProvider } from "../src/ui/surfaceTone";
import { threadListLayout } from "../src/ui/thread-list-layout";
import { PaneChromeControls } from "./fixtures/PaneChromeControls";

let mockReducedMotion = false;
jest.mock("../src/rendering/reduced-motion-store", () => ({
  useReducedMotionPreference: () => mockReducedMotion,
}));

afterEach(() => {
  mockReducedMotion = false;
  jest.restoreAllMocks();
});

const FRAME = 1600;
const SIDEBAR = sidebarWidth(FRAME);
const LEFTS: readonly PaneArrangement["left"][] = ["alone", "beside", "covered", "under"];
const RIGHTS: readonly PaneArrangement["right"][] = ["beside", "cover", "offscreen"];

function arrangement(
  left: PaneArrangement["left"],
  right: PaneArrangement["right"],
): PaneArrangement {
  return {
    centerLeftRadius: left === "beside" ? radii.composer : 0,
    centerRightRadius: right === "beside" ? radii.composer : 0,
    left,
    right,
    sidebar: left !== "under",
  };
}

const COMBINATIONS = LEFTS.flatMap((left) =>
  RIGHTS.map((right) => [left, right, arrangement(left, right)] as const),
);

/** Plain stand-ins for shared values: the derivation reads and writes only through get/set. */
function motionState({
  frameWidth = FRAME,
  from,
  moving,
  progress,
  to,
}: {
  readonly frameWidth?: number;
  readonly from: PaneGeometry;
  readonly moving: boolean;
  readonly progress: number;
  readonly to: PaneArrangement;
}): PaneMotionState {
  const box = <Value,>(initial: Value) => {
    let value = initial;
    return {
      get: () => value,
      set: (next: Value) => {
        value = next;
      },
      get value() {
        return value;
      },
      set value(next: Value) {
        value = next;
      },
    };
  };
  // WHY: the worklets only call `get`/`set` and hand the frame ref to `measure`, which the tests
  // stub; a full Reanimated SharedValue and AnimatedRef need the native runtime.
  return {
    arrangement: box(to),
    frameRef: { current: null },
    frameWidth: box(frameWidth),
    from: box(from),
    moving: box(moving),
    progress: box(progress),
  } as unknown as PaneMotionState;
}

/** The frame the UI thread measures when a motion starts. */
function measureFrame(width: number | null): jest.SpyInstance {
  return jest
    .spyOn(Reanimated, "measure")
    .mockReturnValue(
      width === null ? null : { height: 800, pageX: 0, pageY: 0, width, x: 0, y: 0 },
    );
}

/** Every pane box's style for the state, as the animated styles read it. */
function frames(state: PaneMotionState) {
  return {
    catalog: catalogFrame(state),
    centerClip: centerClipFrame(state),
    centerContent: centerContentFrame(state),
    destination: destinationFrame(state),
    right: rightFrame(state),
  };
}

/** Holds the spring where it starts and returns the callback that settles it. */
function holdSpring(): () => void {
  let settle: ((finished?: boolean) => void) | undefined;
  jest.spyOn(Reanimated, "withSpring").mockImplementation((_to, _config, callback) => {
    settle = callback;
    return 0;
  });
  return () => {
    settle?.(true);
  };
}

describe("settled geometry of every pane combination", () => {
  it.each(COMBINATIONS)("places left %s with right %s", (left, right, target) => {
    const pane = paneGeometry(target, FRAME);
    const expectedDetailX = { alone: FRAME, beside: SIDEBAR, covered: 0, under: 0 }[left];
    expect(pane.detailX).toBe(expectedDetailX);
    expect(pane.catalogOpacity).toBe(left === "covered" ? COVERED_CATALOG_OPACITY : 1);
    expect(pane.catalogWidth).toBe(left === "beside" || left === "covered" ? SIDEBAR : FRAME);
    if (right === "beside") {
      // Center and right split the destination equally and share one edge.
      expect(pane.centerClipWidth).toBe(pane.rightWidth);
      expect(pane.centerClipWidth + pane.rightWidth).toBe(pane.detailWidth);
      expect(pane.rightX).toBe(pane.detailX + pane.centerClipWidth);
    } else if (right === "cover") {
      expect(pane.rightX).toBe(pane.detailX);
      expect(pane.rightWidth).toBe(pane.detailWidth);
    } else {
      expect(pane.rightX).toBeGreaterThanOrEqual(FRAME);
      expect(pane.centerClipWidth).toBe(pane.detailWidth);
    }
    expect(pane.centerWidth).toBe(pane.centerClipWidth);
    expect(pane.centerLeftRadius).toBe(target.centerLeftRadius);
    expect(pane.centerRightRadius).toBe(target.centerRightRadius);
  });

  it("bounds the sidebar to a share of the frame", () => {
    expect(sidebarWidth(840)).toBe(SIDEBAR_MIN_WIDTH);
    expect(sidebarWidth(1200)).toBeCloseTo(408);
    expect(sidebarWidth(1600)).toBe(SIDEBAR_MAX_WIDTH);
  });
});

describe("settled panes belong to Yoga", () => {
  /** A style value Yoga resolves against the frame, or a constant that no measurement feeds. */
  const isRelative = (value: unknown): boolean =>
    value === 0 ||
    value === "auto" ||
    (typeof value === "string" && /^\d+%$/u.test(value)) ||
    value === SIDEBAR_MIN_WIDTH ||
    value === SIDEBAR_MAX_WIDTH;

  it.each(COMBINATIONS)(
    "lays out left %s with right %s without pixels from a measurement",
    (_left, _right, target) => {
      const settled = frames(
        motionState({
          frameWidth: FRAME,
          from: paneGeometry(target, FRAME),
          moving: false,
          progress: 1,
          to: target,
        }),
      );
      // A stale frame width or start geometry changes nothing once the panes rest.
      const stale = frames(
        motionState({
          frameWidth: 700,
          from: paneGeometry(arrangement("covered", "cover"), 2400),
          moving: false,
          progress: 0.3,
          to: target,
        }),
      );
      expect(stale).toEqual(settled);
      for (const style of Object.values(settled)) {
        for (const key of ["left", "maxWidth", "minWidth", "width"] as const) {
          if (key in style) {
            expect(isRelative(Reflect.get(style, key))).toBe(true);
          }
        }
      }
      expect(settled.destination.transform).toEqual([{ translateX: 0 }]);
      expect(settled.right.transform).toEqual([{ translateX: 0 }]);
    },
  );

  it("gives up no chrome width at rest", () => {
    const state = motionState({
      frameWidth: 700,
      from: paneGeometry(arrangement("beside", "offscreen"), 2400),
      moving: false,
      progress: 0.3,
      to: arrangement("covered", "beside"),
    });
    for (const box of ["catalog", "center", "destination", "right"] as const) {
      expect(currentChromeInset(state, box)).toBe(0);
    }
  });
});

describe("one progress derives every pane property", () => {
  const pairs = COMBINATIONS.flatMap(([fromLeft, fromRight, from]) =>
    COMBINATIONS.map(
      ([toLeft, toRight, to]) =>
        [`${fromLeft}/${fromRight}`, `${toLeft}/${toRight}`, from, to] as const,
    ),
  );

  it.each(pairs)(
    "moves %s to %s from one progress",
    (_from, _to, fromArrangement, toArrangement) => {
      const from = paneGeometry(fromArrangement, FRAME);
      const to = paneGeometry(toArrangement, FRAME);
      const positions = [
        "catalogOpacity",
        "catalogVisibleWidth",
        "centerClipWidth",
        "centerLeftRadius",
        "centerRightRadius",
        "detailVisibleWidth",
        "detailX",
        "rightVisibleWidth",
        "rightX",
      ] as const;
      const layoutWidths = ["catalogWidth", "centerWidth", "detailWidth", "rightWidth"] as const;
      for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
        const pane = interpolatePaneGeometry(from, to, progress);
        for (const key of positions) {
          expect(pane[key]).toBeCloseTo(from[key] + (to[key] - from[key]) * progress);
        }
        // Content keeps one layout width for the whole motion: it is clipped, never reflowed.
        for (const key of layoutWidths) {
          expect(pane[key]).toBe(Math.max(from[key], to[key]));
        }
      }
    },
  );

  it("is a pure function of its inputs", () => {
    const from = paneGeometry(arrangement("beside", "offscreen"), FRAME);
    const to = paneGeometry(arrangement("beside", "beside"), FRAME);
    const snapshot = { ...from };
    expect(interpolatePaneGeometry(from, to, 0.4)).toEqual(interpolatePaneGeometry(from, to, 0.4));
    expect(from).toEqual(snapshot);
  });

  it("keeps the center and right panes on one shared edge while the catalog slides away", () => {
    const from = paneGeometry(arrangement("beside", "beside"), FRAME);
    const to = paneGeometry(arrangement("covered", "beside"), FRAME);
    for (const progress of [0.1, 0.5, 0.9]) {
      const pane = interpolatePaneGeometry(from, to, progress);
      expect(pane.rightX).toBeCloseTo(pane.detailX + pane.centerClipWidth);
    }
  });

  it("frames every moving pane box in explicit pixels from the one progress", () => {
    const from = paneGeometry(arrangement("beside", "offscreen"), FRAME);
    const to = arrangement("covered", "beside");
    const state = motionState({ from, moving: true, progress: 0.3, to });
    const pane = interpolatePaneGeometry(from, paneGeometry(to, FRAME), 0.3);
    expect(movingPaneGeometry(state)).toEqual(pane);
    expect(frames(state)).toEqual({
      catalog: {
        maxWidth: pane.catalogWidth,
        minWidth: pane.catalogWidth,
        opacity: pane.catalogOpacity,
        width: pane.catalogWidth,
      },
      centerClip: {
        borderBottomRightRadius: pane.centerRightRadius,
        borderTopRightRadius: pane.centerRightRadius,
        width: pane.centerClipWidth,
      },
      centerContent: { width: pane.centerWidth },
      destination: {
        borderBottomLeftRadius: pane.centerLeftRadius,
        borderTopLeftRadius: pane.centerLeftRadius,
        flexGrow: 0,
        left: 0,
        position: "absolute",
        transform: [{ translateX: pane.detailX }],
        width: pane.detailWidth,
      },
      right: {
        left: 0,
        transform: [{ translateX: pane.rightX - pane.detailX }],
        width: pane.rightWidth,
      },
    });
  });
});

describe("starting a rearrangement on the UI thread", () => {
  it("settles into Yoga without a spring when motion is not animated", () => {
    const spring = jest.spyOn(Reanimated, "withSpring");
    const settled = jest.fn();
    const next = arrangement("beside", "beside");
    const state = motionState({
      from: paneGeometry(arrangement("beside", "offscreen"), FRAME),
      moving: true,
      progress: 0.4,
      to: arrangement("beside", "offscreen"),
    });

    startPaneMotion(state, { animate: false, generation: 1, next, onSettled: settled });

    expect(spring).not.toHaveBeenCalled();
    expect(state.moving.get()).toBe(false);
    expect(frames(state)).toEqual(
      frames(
        motionState({ from: paneGeometry(next, FRAME), moving: false, progress: 1, to: next }),
      ),
    );
    expect(settled).not.toHaveBeenCalled();
  });

  it("takes the motion's ends from the frame measured now, not an earlier width", () => {
    const settle = holdSpring();
    measureFrame(1200);
    const previous = arrangement("beside", "offscreen");
    const next = arrangement("covered", "beside");
    // The panes rest; the last motion ran in a frame that has since changed size.
    const state = motionState({
      frameWidth: FRAME,
      from: paneGeometry(arrangement("covered", "cover"), FRAME),
      moving: false,
      progress: 1,
      to: previous,
    });

    startPaneMotion(state, { animate: true, generation: 3, next, onSettled: jest.fn() });

    expect(state.moving.get()).toBe(true);
    expect(state.from.get()).toEqual(paneGeometry(previous, 1200));
    // At the start every box stands exactly where Yoga had laid it out in the measured frame.
    expect(movingPaneGeometry(state)).toEqual(
      interpolatePaneGeometry(paneGeometry(previous, 1200), paneGeometry(next, 1200), 0),
    );
    settle();
  });

  it("uses explicit pixels only while moving and releases them to Yoga when it settles", () => {
    const settle = holdSpring();
    measureFrame(1200);
    const settled = jest.fn();
    const next = arrangement("covered", "beside");
    const state = motionState({
      from: paneGeometry(arrangement("beside", "offscreen"), FRAME),
      moving: false,
      progress: 1,
      to: arrangement("beside", "offscreen"),
    });

    startPaneMotion(state, { animate: true, generation: 7, next, onSettled: settled });
    state.progress.set(0.5);
    const moving = frames(state);
    expect(typeof moving.catalog.width).toBe("number");
    expect(moving.destination.position).toBe("absolute");
    expect(typeof moving.right.width).toBe("number");
    expect(settled).not.toHaveBeenCalled();

    state.progress.set(1);
    // The explicit end shows every pane where Yoga lays it out from the rest frames; only the
    // content layout widths, which held the larger end, change as the boxes return to Yoga.
    const end = movingPaneGeometry(state);
    const target = paneGeometry(next, 1200);
    for (const key of [
      "catalogOpacity",
      "catalogVisibleWidth",
      "centerClipWidth",
      "detailVisibleWidth",
      "detailX",
      "rightVisibleWidth",
      "rightX",
    ] as const) {
      expect(end[key]).toBeCloseTo(target[key]);
    }
    settle();

    expect(state.moving.get()).toBe(false);
    expect(frames(state)).toEqual(
      frames(
        motionState({ from: paneGeometry(next, FRAME), moving: false, progress: 1, to: next }),
      ),
    );
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith(7);
  });

  it("springs one progress from where an interrupted motion stands and settles once", () => {
    const spring = jest.spyOn(Reanimated, "withSpring");
    measureFrame(FRAME);
    const settled = jest.fn();
    const from = paneGeometry(arrangement("beside", "offscreen"), FRAME);
    const previous = arrangement("beside", "beside");
    const state = motionState({ from, moving: true, progress: 0.5, to: previous });
    const standing = interpolatePaneGeometry(from, paneGeometry(previous, FRAME), 0.5);

    startPaneMotion(state, {
      animate: true,
      generation: 7,
      next: arrangement("covered", "beside"),
      onSettled: settled,
    });

    expect(spring).toHaveBeenCalledTimes(1);
    expect(spring.mock.calls[0]?.[0]).toBe(1);
    expect(state.from.get()).toEqual(standing);
    expect(state.arrangement.get()).toEqual(arrangement("covered", "beside"));
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith(7);
  });

  it("settles at once into Yoga when the frame has no layout to measure", () => {
    const spring = jest.spyOn(Reanimated, "withSpring");
    measureFrame(null);
    const settled = jest.fn();
    const next = arrangement("covered", "beside");
    const state = motionState({
      from: paneGeometry(arrangement("beside", "offscreen"), FRAME),
      moving: false,
      progress: 1,
      to: arrangement("beside", "offscreen"),
    });

    startPaneMotion(state, { animate: true, generation: 4, next, onSettled: settled });

    expect(spring).not.toHaveBeenCalled();
    expect(state.moving.get()).toBe(false);
    expect(state.arrangement.get()).toEqual(next);
    expect(settled).toHaveBeenCalledWith(4);
  });
});

function PaneContent({ name }: { readonly name: string }): React.JSX.Element {
  return (
    <View>
      <Text testID={`${name}-content`}>{name}</Text>
      <PaneChromeControls name={name} />
    </View>
  );
}

function Workspace({
  desktop = true,
  right = true,
}: {
  readonly desktop?: boolean;
  readonly right?: boolean;
}): React.JSX.Element {
  return (
    <WorkspacePaneFrame
      catalog={<PaneContent name="left" />}
      catalogFocused={false}
      catalogStatus="present"
      desktop={desktop}
      detail={
        <WorkspaceCenterLayout
          active
          center={{ capabilities: {}, content: <PaneContent name="center" />, testID: "center" }}
          right={
            right
              ? {
                  capabilities: { close: jest.fn(), fullscreen: true },
                  content: <PaneContent name="right" />,
                  testID: "right",
                }
              : null
          }
          testID="center-layout"
        />
      }
      presentation={desktop ? { kind: "wide" } : { kind: "detailOnly" }}
      viewportWidth={FRAME}
    />
  );
}

describe("pane motion in the frame", () => {
  it("springs an intentional rearrangement once and snaps it under reduced motion", () => {
    for (const reduced of [false, true]) {
      mockReducedMotion = reduced;
      measureFrame(FRAME);
      const spring = jest.spyOn(Reanimated, "withSpring");
      const view = render(<Workspace />);
      spring.mockClear();
      fireEvent.press(view.getByLabelText("Open right fullscreen"));
      if (reduced) {
        expect(spring).not.toHaveBeenCalled();
      } else {
        expect(spring).toHaveBeenCalled();
      }
      expect(view.getByLabelText("Exit right fullscreen")).toBeVisible();
      view.unmount();
      spring.mockRestore();
    }
  });

  it("does not spring a change that is not a rearrangement", () => {
    const spring = jest.spyOn(Reanimated, "withSpring");
    const view = render(<Workspace right={false} />);
    view.rerender(<Workspace />);
    expect(spring).not.toHaveBeenCalled();
    expect(view.getByTestId("right")).toBeVisible();
  });
});

describe("right pane insets", () => {
  it("keeps the left pane's edge inset on both sides of the right pane", () => {
    // The left pane's reference: its header controls end this far from the pane edge.
    const catalogHeader = render(
      <ThreadListHeaderRow testID="catalog-header">
        <Text>Threads</Text>
      </ThreadListHeaderRow>,
    );
    const reference = StyleSheet.flatten(catalogHeader.getByTestId("catalog-header").props.style);
    catalogHeader.unmount();
    expect(reference.paddingRight).toBe(threadListLayout.edgeInset);

    const view = render(<Workspace />);
    expect(view.getByTestId("right")).toHaveStyle({ paddingHorizontal: reference.paddingRight });
  });

  it("adds no gutter on a phone, where the chat covers the whole screen", () => {
    const view = render(<Workspace desktop={false} />);
    expect(view.getByTestId("right")).not.toHaveStyle({
      paddingHorizontal: threadListLayout.edgeInset,
    });
  });
});

describe("a chat in the recessed right pane paints no inner surface", () => {
  const listInsets = { bottom: 0, top: 0 };

  it("leaves the transcript boundary transparent in both tones", () => {
    for (const tone of ["raised", "recessed"] as const) {
      const view = render(
        <SurfaceToneProvider value={tone}>
          <MessageListBoundary
            contentInsets={listInsets}
            loadingKey="k"
            state={{ status: "ready" }}
          >
            <Text>row</Text>
          </MessageListBoundary>
        </SurfaceToneProvider>,
      );
      expect(view.getByTestId("message-list-boundary")).not.toHaveStyle({
        backgroundColor: expect.any(String) as string,
      });
      view.unmount();
    }
  });

  it("covers a loading transcript in the host canvas color", () => {
    const expected = { raised: colors.conversationSurface, recessed: colors.threadListSurface };
    for (const tone of ["raised", "recessed"] as const) {
      const view = render(
        <SurfaceToneProvider value={tone}>
          <MessageListBoundary
            contentInsets={listInsets}
            loadingKey="k"
            state={{ status: "loading" }}
          >
            <Text>row</Text>
          </MessageListBoundary>
        </SurfaceToneProvider>,
      );
      act(() => undefined);
      expect(
        view.getByTestId("message-list-pending-overlay", { includeHiddenElements: true }),
      ).toHaveStyle({ backgroundColor: expected[tone] });
      view.unmount();
    }
  });

  it("paints an empty transcript in the recessed frame color and keeps raised chats unchanged", () => {
    const expected = { raised: colors.conversationSurface, recessed: colors.threadListSurface };
    for (const tone of ["raised", "recessed"] as const) {
      const view = render(
        <SurfaceToneProvider value={tone}>
          <ConversationEmptyState
            cwd="/workspace"
            historyActivityModel={null}
            historyActivityResourceId={null}
            newChat={false}
            onChangeWorkspaceMode={undefined}
            openProjectPicker={jest.fn()}
            threadSearchActive={false}
            workspaceMode="current"
            workspaceSupport={null}
          />
        </SurfaceToneProvider>,
      );
      expect(view.getByTestId("conversation-empty-state")).toHaveStyle({
        backgroundColor: expected[tone],
      });
      view.unmount();
    }
  });
});
