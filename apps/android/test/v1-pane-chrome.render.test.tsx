import { fireEvent, render, within } from "@testing-library/react-native";
import { Text } from "react-native";
import * as Reanimated from "react-native-reanimated";

import { setOperationalDiagnosticsEnabled } from "../src/data/operational-metrics";
import { ConversationBottomChrome } from "../src/features/conversation/ConversationBottomChrome";
import { WorkspaceCenterLayout } from "../src/routeComposition/WorkspaceCenterLayout";
import { WorkspacePaneFrame } from "../src/routeComposition/WorkspacePaneFrame";
import { ThreePanelsHeader } from "../src/ui/ThreePanelsHeader";

// WHY: the shared render mock re-creates shared values per render; these tests follow one
// rearrangement across renders, so a component keeps its shared values as Reanimated does, and a
// derived value re-derives whenever its component renders (Node has no mapper loop).
jest.mock("react-native-reanimated", () => {
  const { useState } = jest.requireActual<typeof import("react")>("react");
  const shared = jest.requireActual<typeof import("./mocks/Reanimated")>("./mocks/Reanimated");
  const useSharedValue = <Value,>(initial: Value) => useState(() => shared.makeMutable(initial))[0];
  return {
    __esModule: true,
    ...shared,
    useDerivedValue: <Value,>(factory: () => Value) => {
      const derived = useSharedValue(factory());
      derived.set(factory());
      return derived;
    },
    useSharedValue,
  };
});

let mockReducedMotion = false;
jest.mock("../src/rendering/reduced-motion-store", () => ({
  useReducedMotionPreference: () => mockReducedMotion,
}));

afterEach(() => {
  mockReducedMotion = false;
  setOperationalDiagnosticsEnabled(false);
  jest.restoreAllMocks();
});

const FRAME = 1600;

/** Generic pane content: the standard pane header over a bottom bar, as any pane composes them. */
function PaneContent({ name }: { readonly name: string }): React.JSX.Element {
  return (
    <>
      <ThreePanelsHeader back={null} testID={`${name}-header`} title={<Text>{name}</Text>} />
      <ConversationBottomChrome
        composerContent={<Text>{`${name} composer`}</Text>}
        currentOutcome={null}
        failureNotice={null}
        openElsewhereActions={null}
        readOnly
        remoteThread={null}
        reportBottomChromeHeight={jest.fn()}
        requestPrompt={null}
        timeline={[]}
      />
    </>
  );
}

function Workspace(): React.JSX.Element {
  return (
    <WorkspacePaneFrame
      catalog={<Text>catalog</Text>}
      catalogFocused={false}
      catalogStatus="present"
      desktop
      detail={
        <WorkspaceCenterLayout
          active
          center={{
            capabilities: { fullscreen: true },
            content: <PaneContent name="center" />,
            label: "center",
            shows: null,
            testID: "center",
          }}
          right={{
            capabilities: { close: jest.fn(), fullscreen: true },
            content: <PaneContent name="right" />,
            label: "right",
            shows: null,
            testID: "right",
          }}
          testID="center-layout"
        />
      }
      presentation={{ kind: "wide", viewportWidth: FRAME }}
      viewportWidth={FRAME}
    />
  );
}

/** The trailing inset each pane's chrome currently gives up: header and bottom bar alike. */
function chromeInsets(view: ReturnType<typeof render>, pane: "center" | "right") {
  const scope = within(view.getByTestId(pane, { includeHiddenElements: true }));
  return [
    scope.getByTestId(`${pane}-header-chrome`, { includeHiddenElements: true }),
    scope.getByTestId("conversation-bottom-pane-chrome", { includeHiddenElements: true }),
  ];
}

/** Holds the spring halfway: the rearrangement has started and has not settled. */
function stallSpringHalfway(): jest.SpyInstance {
  return jest.spyOn(Reanimated, "withSpring").mockImplementation(() => 0.5);
}

describe("pane chrome follows the visible pane width", () => {
  it("lays chrome out to the whole pane while nothing moves", () => {
    const view = render(<Workspace />);
    for (const pane of ["center", "right"] as const) {
      for (const chrome of chromeInsets(view, pane)) {
        expect(chrome).toHaveStyle({ marginRight: 0 });
      }
    }
  });

  it("gives up the hidden trailing width in the center and right panes mid-rearrangement", () => {
    const spring = stallSpringHalfway();
    const view = render(<Workspace />);
    fireEvent.press(within(view.getByTestId("right")).getByLabelText("Open right fullscreen"));
    expect(spring).toHaveBeenCalled();
    // Re-read the pane context after the UI thread took the new arrangement.
    view.rerender(<Workspace />);
    // Halfway from an equal split to a fullscreen right pane both content boxes hold the whole
    // destination while each pane shows three quarters of it.
    for (const pane of ["center", "right"] as const) {
      for (const chrome of chromeInsets(view, pane)) {
        expect(chrome).toHaveStyle({ marginRight: FRAME / 4 });
      }
    }
  });

  it("keeps chrome at the settled width under reduced motion", () => {
    mockReducedMotion = true;
    const spring = stallSpringHalfway();
    const view = render(<Workspace />);
    fireEvent.press(within(view.getByTestId("right")).getByLabelText("Open right fullscreen"));
    view.rerender(<Workspace />);
    expect(spring).not.toHaveBeenCalled();
    for (const pane of ["center", "right"] as const) {
      for (const chrome of chromeInsets(view, pane)) {
        expect(chrome).toHaveStyle({ marginRight: 0 });
      }
    }
  });
});

describe("pane motion frame probe", () => {
  function framesDuringOneRearrangement(): jest.Mock {
    const setActive = jest.fn();
    jest.spyOn(Reanimated, "useFrameCallback").mockReturnValue({
      callbackId: 1,
      isActive: false,
      setActive,
    });
    const view = render(<Workspace />);
    fireEvent.press(within(view.getByTestId("right")).getByLabelText("Open right fullscreen"));
    return setActive;
  }

  it("never runs a frame callback without Data for geeks", () => {
    expect(framesDuringOneRearrangement()).not.toHaveBeenCalled();
  });

  it("samples frames only for the armed rearrangement with Data for geeks", () => {
    setOperationalDiagnosticsEnabled(true);
    // The render spring settles at once, so the window opens and closes within the press.
    expect(framesDuringOneRearrangement().mock.calls).toEqual([[true], [false]]);
  });
});
