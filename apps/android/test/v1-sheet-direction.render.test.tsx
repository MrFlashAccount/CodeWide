import { render } from "@testing-library/react-native";
import { useLayoutEffect } from "react";
import { I18nManager, Text } from "react-native";

import { SheetDetailTransition, SheetPageTransition } from "../src/ui/SheetPageTransition";

// Native shared values retain identity across route commits; the outgoing native
// page keeps the exit worklet registered before React removes that page.
jest.mock("react-native-reanimated", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const mock = jest.requireActual("./mocks/Reanimated");
  return {
    __esModule: true,
    ...mock,
    Keyframe: class {
      readonly definitions: unknown;
      constructor(definitions: unknown) {
        this.definitions = definitions;
      }
      duration() {
        return this;
      }
    },
    useSharedValue: (initial: unknown) => React.useState(() => mock.useSharedValue(initial))[0],
  };
});
jest.mock("../src/rendering/reduced-motion-store", () => ({
  useReducedMotionPreference: () => false,
}));

// Observe the saved exit callback during the destination commit, before passive
// effects. Running it after render() alone would hide late direction publication.
function ExitProbe({ observe }: { readonly observe: () => void }) {
  useLayoutEffect(observe, [observe]);
  return null;
}

const initialRTL = I18nManager.isRTL;
afterEach(() => {
  I18nManager.isRTL = initialRTL;
});

it.each([
  { locale: "LTR", rtl: false, childEdge: 40, parentEdge: -20 },
  { locale: "RTL", rtl: true, childEdge: -40, parentEdge: 20 },
])(
  "moves both pages from/to the correct physical sides in $locale",
  ({ rtl, childEdge, parentEdge }) => {
    I18nManager.isRTL = rtl;
    const view = render(
      <SheetPageTransition direction={null} routeKey="overview">
        <Text>Overview</Text>
      </SheetPageTransition>,
    );
    expect(view.getByTestId("sheet-page:overview").props.entering).toBeUndefined();

    for (let visit = 0; visit < 3; visit += 1) {
      // Capture the departing page, not the destination's future exit callback.
      const parentExit = view.getByTestId("sheet-page:overview").props.exiting;
      const pushObserved = jest.fn();
      view.rerender(
        <SheetPageTransition direction="forward" routeKey="detail">
          <Text>Detail</Text>
          <ExitProbe observe={() => pushObserved(parentExit({ windowWidth: 1000 }))} />
        </SheetPageTransition>,
      );
      const child = view.getByTestId("sheet-page:detail").props;
      const pushEnter = child.entering({ windowWidth: 1000 });
      expect(pushObserved).toHaveBeenCalledTimes(1);
      const pushExit = pushObserved.mock.calls[0][0];
      expect(pushEnter.initialValues.transform).toEqual([{ translateX: childEdge }]);
      expect(pushEnter.animations.transform).toEqual([{ translateX: 0 }]);
      expect(pushExit.initialValues.transform).toEqual([{ translateX: 0 }]);
      expect(pushExit.animations.transform).toEqual([{ translateX: parentEdge }]);

      const popObserved = jest.fn();
      view.rerender(
        <SheetPageTransition direction="back" routeKey="overview">
          <Text>Overview</Text>
          <ExitProbe observe={() => popObserved(child.exiting({ windowWidth: 1000 }))} />
        </SheetPageTransition>,
      );
      const parent = view.getByTestId("sheet-page:overview").props;
      const popEnter = parent.entering({ windowWidth: 1000 });
      expect(popObserved).toHaveBeenCalledTimes(1);
      const popExit = popObserved.mock.calls[0][0];
      expect(popEnter.initialValues.transform).toEqual([{ translateX: parentEdge }]);
      expect(popEnter.animations.transform).toEqual([{ translateX: 0 }]);
      expect(popExit.initialValues.transform).toEqual([{ translateX: 0 }]);
      expect(popExit.animations.transform).toEqual([{ translateX: childEdge }]);
    }
  },
);

it.each([
  { locale: "LTR", rtl: false, edge: "4%" },
  { locale: "RTL", rtl: true, edge: "-4%" },
])("pushes and pops a retained detail overlay on the child side in $locale", ({ rtl, edge }) => {
  I18nManager.isRTL = rtl;
  const view = render(
    <SheetDetailTransition routeKey="preview">
      <Text>Preview</Text>
    </SheetDetailTransition>,
  );
  const { entering, exiting } = view.getByTestId("sheet-detail:preview").props;
  expect(entering.definitions[0].transform).toEqual([{ translateX: edge }]);
  expect(entering.definitions[100].transform).toEqual([{ translateX: "0%" }]);
  expect(exiting.definitions[0].transform).toEqual([{ translateX: "0%" }]);
  expect(exiting.definitions[100].transform).toEqual([{ translateX: edge }]);
});
