import { fireEvent, render } from "@testing-library/react-native";

import { CatalogModeBar } from "../src/features/pullRequests/CatalogModeBar";
import { colors } from "../src/theme";

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
