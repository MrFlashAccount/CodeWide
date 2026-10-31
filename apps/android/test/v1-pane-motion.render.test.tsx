import { act, fireEvent, render } from "@testing-library/react-native";
import { StyleSheet, Text, View } from "react-native";
import * as Reanimated from "react-native-reanimated";

import { ConversationEmptyState } from "../src/features/conversation/ConversationEmptyState";
import { desktopThreadSidebarWidth } from "../src/presentation/layouts/windowLayout";
import { ThreadListHeaderRow } from "../src/presentation/navigation/ThreadListHeader";
import {
  interpolatePaneGeometry,
  paneGeometry,
  type PaneArrangement,
  type PaneGeometry,
} from "../src/routeComposition/paneGeometry";
import {
  currentPaneGeometry,
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
const SIDEBAR = desktopThreadSidebarWidth(FRAME);
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
    sidebarWidth: left === "under" ? 0 : SIDEBAR,
  };
}

const COMBINATIONS = LEFTS.flatMap((left) =>
  RIGHTS.map((right) => [left, right, arrangement(left, right)] as const),
);

/** Plain stand-ins for shared values: the derivation reads and writes only through get/set. */
function motionState({
  from,
  moving,
  progress,
  to,
}: {
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
  // WHY: the worklets only call `get`/`set`; a full Reanimated SharedValue needs the native runtime.
  return {
    arrangement: box(to),
    frameWidth: box(FRAME),
    from: box(from),
    moving: box(moving),
    progress: box(progress),
  } as unknown as PaneMotionState;
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

  it("keeps a destination moved past the trailing edge at its width beside the catalog", () => {
    expect(paneGeometry(arrangement("alone", "beside"), FRAME).detailWidth).toBe(FRAME - SIDEBAR);
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
        "centerClipWidth",
        "centerLeftRadius",
        "centerRightRadius",
        "detailX",
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

  it("reads the settled arrangement directly while nothing moves", () => {
    const to = arrangement("beside", "beside");
    const state = motionState({
      from: paneGeometry(arrangement("covered", "cover"), FRAME),
      moving: false,
      progress: 0.3,
      to,
    });
    expect(currentPaneGeometry(state)).toEqual(paneGeometry(to, FRAME));
  });

  it("derives a moving frame from the one progress", () => {
    const from = paneGeometry(arrangement("beside", "offscreen"), FRAME);
    const to = arrangement("beside", "beside");
    const state = motionState({ from, moving: true, progress: 0.3, to });
    expect(currentPaneGeometry(state)).toEqual(
      interpolatePaneGeometry(from, paneGeometry(to, FRAME), 0.3),
    );
  });
});

describe("starting a rearrangement on the UI thread", () => {
  it("snaps without a spring when motion is not animated", () => {
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
    expect(state.progress.get()).toBe(1);
    expect(currentPaneGeometry(state)).toEqual(paneGeometry(next, FRAME));
    expect(settled).not.toHaveBeenCalled();
  });

  it("springs one progress from where an interrupted motion stands and settles once", () => {
    const spring = jest.spyOn(Reanimated, "withSpring");
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
      presentation={desktop ? { kind: "wide", viewportWidth: FRAME } : { kind: "detailOnly" }}
      viewportWidth={FRAME}
    />
  );
}

describe("pane motion in the frame", () => {
  it("springs an intentional rearrangement once and snaps it under reduced motion", () => {
    for (const reduced of [false, true]) {
      mockReducedMotion = reduced;
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
