import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { BackHandler, Text, View } from "react-native";

import { desktopThreadSidebarWidth } from "../src/presentation/layouts/windowLayout";
import { WorkspaceCenterLayout } from "../src/routeComposition/WorkspaceCenterLayout";
import { WorkspacePaneFrame } from "../src/routeComposition/WorkspacePaneFrame";
import {
  placeFramePresentation,
  resolvePaneArrangement,
  resolveWorkspacePaneVisibility,
  type WorkspaceFramePresentation,
  type WorkspacePaneCapabilities,
} from "../src/routeComposition/workspacePanes";
import { colors, radii } from "../src/theme";
import { PaneChromeControls } from "./fixtures/PaneChromeControls";

const VIEWPORT = 1600;
const NONE: WorkspacePaneCapabilities = {};
const FULLSCREEN: WorkspacePaneCapabilities = { fullscreen: true };

type BackListener = () => boolean | null | undefined;
let backListeners: BackListener[] = [];

beforeEach(() => {
  backListeners = [];
  jest.spyOn(BackHandler, "addEventListener").mockImplementation((_event, listener) => {
    backListeners.push(listener);
    return {
      remove: () => {
        backListeners = backListeners.filter((candidate) => candidate !== listener);
      },
    };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function pressSystemBack(): boolean {
  return backListeners.toReversed().some((listener) => listener() === true);
}

/** Pane content that renders the chrome the layout resolves for its pane, as a header would. */
function PaneContent({ name }: { readonly name: string }): React.JSX.Element {
  return (
    <View>
      <Text testID={`${name}-content`}>{name}</Text>
      <PaneChromeControls name={name} />
    </View>
  );
}

function Workspace({
  center = NONE,
  desktop = true,
  left = NONE,
  presentation = { kind: "wide", viewportWidth: VIEWPORT },
  right = null,
}: {
  readonly center?: WorkspacePaneCapabilities;
  readonly desktop?: boolean;
  readonly left?: WorkspacePaneCapabilities;
  readonly presentation?: WorkspaceFramePresentation;
  readonly right?: WorkspacePaneCapabilities | null;
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
          center={{
            capabilities: center,
            content: <PaneContent name="center" />,
            label: "center",
            shows: null,
            testID: "center",
          }}
          right={
            right === null
              ? null
              : {
                  capabilities: right,
                  content: <PaneContent name="right" />,
                  label: "right",
                  shows: null,
                  testID: "right",
                }
          }
          testID="center-layout"
        />
      }
      leftCapabilities={left}
      presentation={presentation}
      viewportWidth={VIEWPORT}
    />
  );
}

function expectCenterRadii(
  view: ReturnType<typeof render>,
  expected: { readonly left: number; readonly right: number },
): void {
  expect(view.getByTestId("v1-workspace-destination", { includeHiddenElements: true })).toHaveStyle(
    { borderBottomLeftRadius: expected.left, borderTopLeftRadius: expected.left },
  );
  expect(view.getByTestId("center", { includeHiddenElements: true })).toHaveStyle({
    borderBottomRightRadius: expected.right,
    borderTopRightRadius: expected.right,
  });
}

describe("the left and right panes are never visible together", () => {
  const frames: readonly (readonly [boolean, WorkspaceFramePresentation])[] = [
    [true, { kind: "wide", viewportWidth: VIEWPORT }],
    [true, { kind: "catalogOnly" }],
    [false, { kind: "catalogOnly" }],
    [false, { kind: "detailOnly" }],
    [false, { kind: "stacked" }],
  ];
  const requests = [null, "left", "center", "right"] as const;

  it.each(frames)("resolves desktop %s %o to one side of the center", (desktop, presentation) => {
    for (const fullscreen of requests) {
      for (const rightPresent of [false, true]) {
        const visibility = resolveWorkspacePaneVisibility({
          fullscreen,
          multiPane: desktop && presentation.kind === "wide",
          rightPresent,
        });
        const arrangement = resolvePaneArrangement({
          presentation: placeFramePresentation(presentation, visibility),
          rightPresent,
          visibility,
        });
        if (arrangement.right === "beside") {
          expect(arrangement.left).toBe("covered");
          expect(arrangement.centerLeftRadius).toBe(0);
        }
        if (arrangement.left === "beside") {
          expect(arrangement.right).toBe("offscreen");
        }
      }
    }
  });
});

describe("center corners follow the one visible neighbouring pane", () => {
  it("rounds the left side beside the left pane only", () => {
    expectCenterRadii(render(<Workspace />), { left: radii.composer, right: 0 });
  });

  it("rounds only the right side beside the right pane, which covers the left pane", () => {
    expectCenterRadii(render(<Workspace right={NONE} />), { left: 0, right: radii.composer });
  });

  it("rounds nothing on a phone, where panes never sit side by side", () => {
    const view = render(
      <Workspace desktop={false} presentation={{ kind: "detailOnly" }} right={NONE} />,
    );
    expect(view.getByTestId("center", { includeHiddenElements: true })).toHaveStyle({
      borderTopRightRadius: 0,
    });
    expect(view.getByTestId("v1-workspace-destination")).not.toHaveStyle({
      borderTopLeftRadius: radii.composer,
    });
  });

  it("rounds nothing in fullscreen, which has no neighbours", async () => {
    const view = render(<Workspace center={FULLSCREEN} right={NONE} />);
    fireEvent.press(view.getByLabelText("Open center fullscreen"));
    await waitFor(() => {
      expect(view.getByLabelText("Exit center fullscreen")).toBeVisible();
    });
    expectCenterRadii(view, { left: 0, right: 0 });
  });
});

it("paints the right pane like the left pane, with no border against the center", () => {
  const view = render(<Workspace right={NONE} />);
  const right = view.getByTestId("right");
  expect(right).toHaveStyle({ backgroundColor: colors.threadListSurface });
  expect(view.getByTestId("v1-workspace-pane-frame")).toHaveStyle({
    backgroundColor: colors.threadListSurface,
  });
  expect(right).not.toHaveStyle({ borderLeftWidth: expect.any(Number) as number });
  expect(view.getByTestId("center")).toHaveStyle({ backgroundColor: colors.conversationSurface });
});

describe("pane widths", () => {
  const sidebar = desktopThreadSidebarWidth(VIEWPORT);

  it("keeps the sidebar width for the left pane beside the center", () => {
    const view = render(<Workspace />);
    expect(view.getByTestId("workspace-catalog-pane")).toHaveStyle({ opacity: 1, width: sidebar });
    expect(view.getByTestId("v1-workspace-destination")).toHaveStyle({
      transform: [{ translateX: sidebar }],
      width: VIEWPORT - sidebar,
    });
    expect(view.getByTestId("center")).toHaveStyle({ width: VIEWPORT - sidebar });
  });

  it("covers the left pane and splits the whole width equally beside the right pane", () => {
    const view = render(<Workspace right={NONE} />);
    // The covered catalog keeps its width and dims under the destination.
    const catalog = view.getByTestId("workspace-catalog-pane", { includeHiddenElements: true });
    expect(catalog).toHaveStyle({ opacity: 0, width: sidebar });
    expect(catalog).toHaveProp("pointerEvents", "none");
    expect(view.getByTestId("left-content", { includeHiddenElements: true })).not.toBeVisible();
    expect(view.getByTestId("v1-workspace-destination")).toHaveStyle({
      transform: [{ translateX: 0 }],
      width: VIEWPORT,
    });
    expect(view.getByTestId("center")).toHaveStyle({ width: VIEWPORT / 2 });
    expect(view.getByTestId("right")).toHaveStyle({
      transform: [{ translateX: VIEWPORT / 2 }],
      width: VIEWPORT / 2,
    });
  });

  it("restores the left pane when the right pane closes", async () => {
    const view = render(<Workspace right={NONE} />);
    const left = view.getByTestId("left-content", { includeHiddenElements: true });
    expect(left).not.toBeVisible();

    view.rerender(<Workspace right={null} />);
    await waitFor(() => {
      expect(view.getByTestId("left-content")).toBeVisible();
    });
    expect(view.getByTestId("left-content")).toBe(left);
    expect(view.getByTestId("workspace-catalog-pane")).toHaveStyle({ opacity: 1, width: sidebar });
    expect(view.getByTestId("v1-workspace-destination")).toHaveStyle({
      transform: [{ translateX: sidebar }],
      width: VIEWPORT - sidebar,
    });
    expectCenterRadii(view, { left: radii.composer, right: 0 });
  });

  it("lets a fullscreen right pane cover the whole frame", async () => {
    const view = render(<Workspace right={FULLSCREEN} />);
    fireEvent.press(view.getByLabelText("Open right fullscreen"));
    await waitFor(() => {
      expect(view.getByTestId("right")).toHaveStyle({
        transform: [{ translateX: 0 }],
        width: VIEWPORT,
      });
    });
    expect(view.getByTestId("workspace-catalog-pane", { includeHiddenElements: true })).toHaveStyle(
      { opacity: 0 },
    );
  });
});

describe("fullscreen shows one declared pane alone and keeps the others mounted", () => {
  // The left pane is visible only while no right pane covers it, so it enters fullscreen from the
  // left+center split; the center and right panes enter it from the center+right split.
  it.each([
    ["left", null],
    ["center", FULLSCREEN],
    ["right", FULLSCREEN],
  ] as const)("shows the %s pane alone", async (pane, right) => {
    const view = render(<Workspace center={FULLSCREEN} left={FULLSCREEN} right={right} />);
    const panes = right === null ? (["left", "center"] as const) : (["center", "right"] as const);
    const instances = new Map(
      panes.map((name) => [name, view.getByTestId(`${name}-content`)] as const),
    );

    fireEvent.press(view.getByLabelText(`Open ${pane} fullscreen`));
    await waitFor(() => {
      expect(view.getByLabelText(`Exit ${pane} fullscreen`)).toBeVisible();
    });
    for (const [other, instance] of instances) {
      const content = view.getByTestId(`${other}-content`, { includeHiddenElements: true });
      expect(content).toBe(instance);
      if (other === pane) {
        expect(content).toBeVisible();
      } else {
        expect(content).not.toBeVisible();
      }
    }

    act(() => {
      expect(pressSystemBack()).toBe(true);
    });
    await waitFor(() => {
      expect(view.getByLabelText(`Open ${pane} fullscreen`)).toBeVisible();
    });
    for (const [other, instance] of instances) {
      expect(view.getByTestId(`${other}-content`)).toBe(instance);
      expect(instance).toBeVisible();
    }
    expect(pressSystemBack()).toBe(false);
  });

  it("offers no fullscreen to a left pane the right pane covers", () => {
    const view = render(<Workspace left={FULLSCREEN} right={NONE} />);
    expect(
      view.queryByLabelText("Open left fullscreen", { includeHiddenElements: true }),
    ).toBeNull();
  });

  it("closes a fullscreen pane back into the split", async () => {
    const closeRight = jest.fn();
    const view = render(<Workspace right={{ close: closeRight, fullscreen: true }} />);
    fireEvent.press(view.getByLabelText("Open right fullscreen"));
    await waitFor(() => {
      expect(view.getByLabelText("Exit right fullscreen")).toBeVisible();
    });
    expect(view.queryByTestId("center-content")).toBeNull();

    fireEvent.press(view.getByLabelText("Close right"));
    await waitFor(() => {
      expect(closeRight).toHaveBeenCalledTimes(1);
    });
    view.rerender(<Workspace right={null} />);
    expect(view.getByTestId("center-content")).toBeVisible();
    expect(view.getByTestId("left-content")).toBeVisible();
  });
});

describe("pane chrome comes only from declared capabilities", () => {
  it("renders no actions for a pane that declares none", () => {
    const view = render(<Workspace right={NONE} />);
    for (const pane of ["left", "center", "right"]) {
      expect(
        view.getByTestId(`${pane} chrome`, { includeHiddenElements: true }),
      ).toBeEmptyElement();
    }
  });

  it("renders exactly the declared actions of each pane", () => {
    const view = render(<Workspace center={FULLSCREEN} right={{ close: jest.fn() }} />);
    expect(view.getByLabelText("Open center fullscreen")).toBeVisible();
    expect(view.queryByLabelText("Close center")).toBeNull();
    expect(view.getByLabelText("Close right")).toBeVisible();
    expect(view.queryByLabelText("Open right fullscreen")).toBeNull();
    expect(view.getByTestId("left chrome", { includeHiddenElements: true })).toBeEmptyElement();
    expect(view.queryByText(/Widen|Narrow/u)).toBeNull();
  });

  it("offers no fullscreen on a phone even where it is declared", () => {
    const view = render(
      <Workspace
        center={FULLSCREEN}
        desktop={false}
        presentation={{ kind: "detailOnly" }}
        right={{ close: jest.fn(), fullscreen: true }}
      />,
    );
    expect(view.queryByLabelText(/^Open .* fullscreen$/u)).toBeNull();
    expect(view.getByLabelText("Close right")).toBeVisible();
  });
});
