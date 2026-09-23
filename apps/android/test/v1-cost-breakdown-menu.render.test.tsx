import { act, fireEvent, render, within } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Dimensions, View } from "react-native";
import {
  CostBreakdownMenu,
  CostBreakdownMenuProvider,
} from "../src/features/accounts/CostBreakdownMenu";
import type { TokenCostEstimate } from "../src/turn-cost";

// WHY: Jest cannot compose Android views. Keep the real menu, anchor and body lifecycle;
// replace only the external Compose adapter and its modifiers.
jest.mock("@expo/ui/jetpack-compose", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const Container = ({ children }: { children?: ReactNode }) => <View>{children}</View>;
  const Host = ({ children }: { children?: ReactNode }) => (
    <View testID="cost-compose-host">{children}</View>
  );
  const Menu = (props: { children?: ReactNode; expanded: boolean; onDismissRequest(): void }) => (
    <View {...props} testID="cost-popup" />
  );
  return {
    Host,
    RNHostView: Container,
    DropdownMenu: Object.assign(Menu, { Trigger: Container, Items: Container }),
  };
});
jest.mock("@expo/ui/jetpack-compose/modifiers", () => ({
  width: (value: number) => ({ width: value }),
}));

type Measure = (left: number, top: number, width: number, height: number) => void;
const pending: Measure[] = [];
let defer = false;
const node = {
  measureInWindow(receive: Measure) {
    if (defer) pending.push(receive);
    else receive(10, 120, 55, 20);
  },
};
const renderOptions = { createNodeMock: () => node };
function estimate(model: string, totalCostUsd = 0.1): TokenCostEstimate {
  return {
    model,
    totalCostUsd,
    pricingVersion: "test",
    currency: "USD",
    basis: "apiEquivalent",
    price: { input: 1, cachedInput: 0.1, output: 2 },
    uncachedInputTokens: 100,
    cachedInputTokens: 50,
    cacheWriteInputTokens: 0,
    outputTokens: 20,
    cacheHitPercent: 33,
    uncachedInputCostUsd: 0.01,
    cachedInputCostUsd: 0.001,
    cacheWriteInputCostUsd: 0,
    outputCostUsd: 0.02,
  };
}
function Messages({ values }: { values: readonly TokenCostEstimate[] }) {
  return (
    <CostBreakdownMenuProvider>
      {values.map((value) => (
        <CostBreakdownMenu key={value.model} estimate={value} />
      ))}
    </CostBreakdownMenuProvider>
  );
}
beforeEach(() => {
  pending.length = 0;
  defer = false;
  jest.spyOn(View.prototype, "measureInWindow").mockImplementation(node.measureInWindow);
});
afterEach(() => jest.restoreAllMocks());

it("mounts no native cost menus for closed rows and shares one popup across messages", () => {
  const values = Array.from({ length: 30 }, (_, index) => estimate(`model-${index}`));
  const view = render(<Messages values={values} />, renderOptions);
  expect(view.queryAllByTestId("cost-compose-host")).toHaveLength(0);
  expect(view.queryByTestId("turn-cost-breakdown")).toBeNull();
  const triggers = view.getAllByRole("button");
  const first = triggers[0];
  if (first === undefined) throw new Error("Missing cost trigger");
  fireEvent.press(first);
  expect(view.getAllByTestId("cost-compose-host")).toHaveLength(1);
  expect(view.getByText("model-0")).toBeVisible();
  const staleDismiss = view.getByTestId("cost-popup").props.onDismissRequest;
  const next = triggers[1];
  if (next === undefined) throw new Error("Missing second cost trigger");
  fireEvent.press(next);
  act(() => staleDismiss());
  expect(view.queryByText("model-0")).toBeNull();
  expect(view.getByText("model-1")).toBeVisible();
  expect(view.getAllByTestId("cost-compose-host")).toHaveLength(1);
  fireEvent.press(next);
  expect(view.queryByTestId("cost-popup")).toBeNull();
  fireEvent.press(first);
  fireEvent(view.getByTestId("cost-popup"), "dismissRequest");
  expect(view.queryByTestId("cost-compose-host")).toBeNull();
});

it("updates an open estimate and closes when its source row leaves the list", () => {
  const initial = estimate("live");
  const view = render(<Messages values={[initial]} />, renderOptions);
  fireEvent.press(view.getByRole("button"));
  expect(view.getByText("live")).toBeVisible();
  const updated = estimate("live", 2);
  view.rerender(<Messages values={[updated]} />);
  expect(view.getByLabelText("Estimated API-equivalent cost $2.00")).toBeVisible();
  // The actual open body must receive the new estimate, not only the trigger label.
  expect(within(view.getByTestId("turn-cost-breakdown")).getByLabelText("$2.00")).toBeVisible();
  view.rerender(<Messages values={[]} />);
  expect(view.queryByTestId("cost-popup")).toBeNull();
});

it("ignores reordered measurements and cancelled or unmounted sources", () => {
  const view = render(
    <Messages values={[estimate("first"), estimate("second", 0.2)]} />,
    renderOptions,
  );
  defer = true;
  const buttons = view.getAllByRole("button");
  const first = buttons[0];
  const second = buttons[1];
  if (first === undefined || second === undefined) throw new Error("Missing triggers");
  fireEvent.press(first);
  fireEvent.press(second);
  defer = false;
  act(() => pending[1]?.(40, 300, 60, 20));
  act(() => pending[0]?.(40, 100, 60, 20));
  expect(view.getByText("second")).toBeVisible();
  expect(view.queryByText("first")).toBeNull();
  fireEvent.press(second);
  defer = true;
  fireEvent.press(first);
  fireEvent.press(first);
  defer = false;
  act(() => pending[2]?.(40, 100, 60, 20));
  expect(view.queryByTestId("cost-popup")).toBeNull();
  defer = true;
  fireEvent.press(first);
  view.rerender(<Messages values={[]} />);
  defer = false;
  act(() => pending[3]?.(40, 100, 60, 20));
  expect(view.queryByTestId("cost-popup")).toBeNull();
});

it("anchors to measured row bounds and requires fresh measurements after window resize", () => {
  const window = Dimensions.get("window");
  const view = render(<Messages values={[estimate("bounds")]} />, renderOptions);
  jest
    .spyOn(View.prototype, "measureInWindow")
    .mockImplementationOnce((receive) => receive(80, 240, 55, 20))
    .mockImplementationOnce((receive) => receive(10, 40, 400, 800));
  fireEvent.press(view.getByRole("button"));
  expect(view.getByTestId("cost-menu-anchor")).toHaveStyle({
    left: 70,
    top: 200,
    width: 55,
    height: 20,
  });
  act(() => Dimensions.set({ window: { ...window, width: window.width + 100 } }));
  expect(view.queryByTestId("cost-popup")).toBeNull();
  jest
    .spyOn(View.prototype, "measureInWindow")
    .mockImplementationOnce((receive) => receive(150, 170, 60, 20))
    .mockImplementationOnce((receive) => receive(10, 40, 500, 800));
  fireEvent.press(view.getByRole("button"));
  expect(view.getByTestId("cost-menu-anchor")).toHaveStyle({
    left: 140,
    top: 130,
    width: 60,
    height: 20,
  });
  act(() => Dimensions.set({ window }));
});
