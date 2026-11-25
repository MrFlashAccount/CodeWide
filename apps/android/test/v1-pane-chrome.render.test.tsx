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
      presentation={{ kind: "wide" }}
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

/**
 * Holds the spring halfway in a frame the UI thread measures `FRAME` wide: the rearrangement has
 * started and has not settled.
 */
function stallSpringHalfway(): jest.SpyInstance {
  jest
    .spyOn(Reanimated, "measure")
    .mockReturnValue({ height: 800, pageX: 0, pageY: 0, width: FRAME, x: 0, y: 0 });
  return jest.spyOn(Reanimated, "withSpring").mockImplementation(() => 0.5);
}

describe("pane chrome follows the visible pane width", () => {
  it("lays both visible headers out to their whole pane once the split is placed", () => {
    const view = render(<Workspace />);
    // Sample the derived styles after the right pane registers with the frame.
    view.rerender(<Workspace />);
    for (const pane of ["center", "right"] as const) {
      for (const chrome of chromeInsets(view, pane)) {
        expect(chrome).toHaveStyle({ marginRight: 0 });
      }
    }
  });

  it("gives up the hidden trailing width in the center and right panes mid-rearrangement", () => {
    const spring = stallSpringHalfway();
    const view = render(<Workspace />);
    fireEvent(view.getByLabelText("Resize panels"), "accessibilityAction", {nativeEvent:{actionName:"hide-leading"}});
    expect(spring).toHaveBeenCalled();
    // Re-read the pane context after the UI thread took the new arrangement.
    view.rerender(<Workspace />);
    // The center keeps its half-width layout and shows one quarter of the frame. The
    // right grows to the remaining three quarters, with its chrome at that edge.
    expect(view.getByTestId("center", { includeHiddenElements: true })).toHaveStyle({
      width: FRAME / 4,
    });
    for (const pane of ["center", "right"] as const) {
      for (const chrome of chromeInsets(view, pane)) {
        expect(chrome).toHaveStyle({ marginRight: pane === "center" ? FRAME / 4 : 0 });
      }
    }
  });

  it("keeps chrome at the settled width under reduced motion", () => {
    mockReducedMotion = true;
    const spring = stallSpringHalfway();
    const view = render(<Workspace />);
    fireEvent(view.getByLabelText("Resize panels"), "accessibilityAction", {nativeEvent:{actionName:"hide-leading"}});
    view.rerender(<Workspace />);
    expect(spring).not.toHaveBeenCalled();
    for (const chrome of chromeInsets(view, "center")) {
      expect(chrome).toHaveStyle({ marginRight: "100%" });
    }
    for (const chrome of chromeInsets(view, "right")) {
      expect(chrome).toHaveStyle({ marginRight: 0 });
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
    fireEvent(view.getByLabelText("Resize panels"), "accessibilityAction", {nativeEvent:{actionName:"hide-leading"}});
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
