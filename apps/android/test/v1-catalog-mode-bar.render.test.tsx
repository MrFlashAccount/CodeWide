import { fireEvent, render } from "@testing-library/react-native";
import * as Reanimated from "react-native-reanimated";

import { CatalogModeBar } from "../src/features/pullRequests/CatalogModeBar";
import { colors } from "../src/theme";
import { startPillSelectionOnUI } from "../vendor/reacticx/src/components/organisms/masked-tab-bar/motion";

it("exposes the two masked destinations as accessible tabs", () => {
  const onSelect = jest.fn();
  const view = render(
    <CatalogModeBar mode="threads" onSelect={onSelect} reviewRequestedCount={2} />,
  );

  expect(view.getByTestId("catalog-mode-bar")).not.toHaveStyle({
    backgroundColor: colors.threadListSurface,
  });
  expect(view.getByRole("tab", { name: "Threads" }).props.accessibilityState).toEqual({
    selected: true,
  });
  expect(view.getByRole("tab", { name: "Pull requests 2" }).props.accessibilityState).toEqual({
    selected: false,
  });

  fireEvent(view.getByRole("tab", { name: "Pull requests 2" }), "accessibilityAction", {
    nativeEvent: { actionName: "activate" },
  });
  expect(onSelect).toHaveBeenCalledWith("pullRequests");

  fireEvent(view.getByRole("tab", { name: "Threads" }), "accessibilityTap");
  expect(onSelect).toHaveBeenCalledTimes(1);
});

it("starts pointer selection motion before handing route selection to JavaScript", () => {
  const spring = jest.spyOn(Reanimated, "withSpring");
  const onSelect = jest.fn();
  const pillX = { value: 0 };
  const pillWidth = { value: 150 };
  spring.mockClear();

  startPillSelectionOnUI(
    { value: "pullRequests", width: 150, x: 150 },
    pillX,
    pillWidth,
    onSelect,
  );

  expect(pillX.value).toBe(150);
  expect(pillWidth.value).toBe(150);
  expect(onSelect).toHaveBeenCalledWith("pullRequests");
  const selectionOrder = onSelect.mock.invocationCallOrder[0];
  expect(
    spring.mock.invocationCallOrder.filter((order) => order < selectionOrder),
  ).toHaveLength(2);
  spring.mockRestore();
});
