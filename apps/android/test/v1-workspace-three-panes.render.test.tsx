import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { BackHandler, Text, View } from "react-native";

import { desktopThreadSidebarWidth } from "../src/presentation/layouts/windowLayout";
import { WorkspaceCenterLayout } from "../src/routeComposition/WorkspaceCenterLayout";
import { WorkspacePaneFrame } from "../src/routeComposition/WorkspacePaneFrame";
import {
  useWorkspacePaneChrome,
  type WorkspacePaneCapabilities,
} from "../src/routeComposition/workspacePanes";
import type { WorkspaceTwoPanePresentation } from "../src/routeComposition/WorkspaceTwoPaneLayout";
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
  const chrome = useWorkspacePaneChrome();
  return (
    <View>
      <Text testID={`${name}-content`}>{name}</Text>
      <PaneChromeControls chrome={chrome} name={name} />
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
  readonly presentation?: WorkspaceTwoPanePresentation;
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
            testID: "center",
          }}
          right={
            right === null
              ? null
              : { capabilities: right, content: <PaneContent name="right" />, testID: "right" }
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

describe("center corners follow the visible neighbouring panes", () => {
  it("rounds the left side beside the left pane only", () => {
    expectCenterRadii(render(<Workspace />), { left: radii.composer, right: 0 });
  });

  it("rounds both sides between the left and right panes", () => {
    expectCenterRadii(render(<Workspace right={NONE} />), {
      left: radii.composer,
      right: radii.composer,
    });
  });

  it("rounds the right side when the left pane is hidden", () => {
    const view = render(
      <Workspace
        presentation={{ kind: "wideDetailExpanded", viewportWidth: VIEWPORT }}
        right={NONE}
      />,
    );
    expectCenterRadii(view, { left: 0, right: radii.composer });
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
    fireEvent.press(view.getByLabelText("center menu: Fullscreen"));
    await waitFor(() => {
      expect(view.getByLabelText("center menu: Exit fullscreen")).toBeVisible();
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

  it("splits the rest equally between the center and right panes", () => {
    const view = render(<Workspace right={NONE} />);
    expect(view.getByTestId("workspace-catalog-pane")).toHaveStyle({ width: sidebar });
    const share = (VIEWPORT - sidebar) / 2;
    expect(view.getByTestId("center")).toHaveStyle({ width: share });
    expect(view.getByTestId("right")).toHaveStyle({
      transform: [{ translateX: share }],
      width: share,
    });
  });

  it("gives the center and right panes the whole width when the left pane is hidden", () => {
    const view = render(
      <Workspace
        presentation={{ kind: "wideDetailExpanded", viewportWidth: VIEWPORT }}
        right={NONE}
      />,
    );
    // The covered catalog keeps its width and dims under the destination.
    expect(view.getByTestId("workspace-catalog-pane", { includeHiddenElements: true })).toHaveStyle(
      { opacity: 0, width: sidebar },
    );
    expect(view.getByTestId("v1-workspace-destination")).toHaveStyle({
      transform: [{ translateX: 0 }],
      width: VIEWPORT,
    });
    expect(view.getByTestId("center")).toHaveStyle({ width: VIEWPORT / 2 });
    expect(view.getByTestId("right")).toHaveStyle({ width: VIEWPORT / 2 });
  });

  it("lets a fullscreen right pane cover the whole frame", async () => {
    const view = render(<Workspace right={FULLSCREEN} />);
    fireEvent.press(view.getByLabelText("right menu: Fullscreen"));
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
  it.each(["left", "center", "right"] as const)("shows the %s pane alone", async (pane) => {
    const view = render(<Workspace center={FULLSCREEN} left={FULLSCREEN} right={FULLSCREEN} />);
    const instances = {
      center: view.getByTestId("center-content"),
      left: view.getByTestId("left-content"),
      right: view.getByTestId("right-content"),
    };

    fireEvent.press(view.getByLabelText(`${pane} menu: Fullscreen`));
    await waitFor(() => {
      expect(view.getByLabelText(`${pane} menu: Exit fullscreen`)).toBeVisible();
    });
    for (const other of ["left", "center", "right"] as const) {
      const content = view.getByTestId(`${other}-content`, { includeHiddenElements: true });
      expect(content).toBe(instances[other]);
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
      expect(view.getByLabelText(`${pane} menu: Fullscreen`)).toBeVisible();
    });
    for (const other of ["left", "center", "right"] as const) {
      expect(view.getByTestId(`${other}-content`)).toBe(instances[other]);
      expect(instances[other]).toBeVisible();
    }
    expect(pressSystemBack()).toBe(false);
  });

  it("closes a fullscreen pane back into the split", async () => {
    const closeRight = jest.fn();
    const view = render(<Workspace right={{ close: closeRight, fullscreen: true }} />);
    fireEvent.press(view.getByLabelText("right menu: Fullscreen"));
    await waitFor(() => {
      expect(view.getByLabelText("right menu: Exit fullscreen")).toBeVisible();
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
      expect(view.getByTestId(`${pane} chrome`)).toBeEmptyElement();
    }
  });

  it("renders exactly the declared actions of each pane", () => {
    const view = render(<Workspace center={FULLSCREEN} right={{ close: jest.fn() }} />);
    expect(view.getByLabelText("center menu: Fullscreen")).toBeVisible();
    expect(view.queryByLabelText("Close center")).toBeNull();
    expect(view.getByLabelText("Close right")).toBeVisible();
    expect(view.queryByLabelText("right menu: Fullscreen")).toBeNull();
    expect(view.getByTestId("left chrome")).toBeEmptyElement();
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
    expect(view.queryByLabelText(/menu: Fullscreen/u)).toBeNull();
    expect(view.getByLabelText("Close right")).toBeVisible();
  });
});
