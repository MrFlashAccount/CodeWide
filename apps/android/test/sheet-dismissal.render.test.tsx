import { fireEvent, render } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Text } from "react-native";

import { AppSheet } from "../src/ui/AppSheet.android";
import { PresentationSheetView } from "../src/v2/presentation/surfaces/PresentationSheetView.android";

// WHY: Node cannot create a Compose window. Keep the real sheet and mock only its native host.
jest.mock("@expo/ui/jetpack-compose", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const Host = ({ children }: { children?: ReactNode }) => <View>{children}</View>;
  return {
    Host,
    RNHostView: Host,
    ModalBottomSheet: (props: { children?: ReactNode; onDismissRequest(): void }) => <View testID="native-sheet" {...props} />,
  };
});

describe.each([["legacy", AppSheet], ["v2", PresentationSheetView]] as const)("%s sheet dismissal", (_name, Sheet) => {
  it("automatically exposes a content-free native diagnostic marker and updates it on page changes", () => {
    const view = render(<Sheet isOpen onOpenChange={jest.fn()} contentProps={{ dismissLabel: "Private project name" }}><Text>Private content</Text></Sheet>);
    expect(view.getByTestId("performance-sheet:sheet")).toBeVisible();
    view.rerender(<Sheet isOpen onOpenChange={jest.fn()} contentProps={{ performanceSurface: "ports" }}><Text>Private content</Text></Sheet>);
    expect(view.getByTestId("performance-sheet:ports")).toBeVisible();
    expect(view.queryByTestId("performance-sheet:sheet")).toBeNull();
  });
  it("delegates the handle and dismissal to Material without a second React control", () => {
    const change = jest.fn();
    const view = render(<Sheet isOpen onOpenChange={change} contentProps={{ dismissLabel: "Close ports" }}><Text>Ports</Text></Sheet>);
    expect(view.queryAllByRole("button")).toHaveLength(0);
    expect(view.getByTestId("native-sheet").props.showDragHandle).toBe(true);
    expect(view.getByTestId("native-sheet").props.containerColor).toBeUndefined();
    expect(view.getByTestId("native-sheet").props.scrimColor).toBeUndefined();
    fireEvent(view.getByTestId("native-sheet"), "dismissRequest");
    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenLastCalledWith(false);
    expect(view.getByTestId("native-sheet").props.properties).toEqual({
      shouldDismissOnBackPress: true,
      shouldDismissOnClickOutside: true,
    });
    expect(view.getByTestId("native-sheet").props.sheetGesturesEnabled).toBe(true);
  });

  it("does not offer handle dismissal while the owning flow forbids closing", () => {
    const change = jest.fn();
    const view = render(<Sheet isOpen onOpenChange={change} contentProps={{ enablePanDownToClose: false }}><Text>Saving</Text></Sheet>);
    expect(view.queryByLabelText("Dismiss sheet")).toBeNull();
    expect(view.getByTestId("native-sheet").props.showDragHandle).toBe(false);
    expect(change).not.toHaveBeenCalled();
    expect(view.getByTestId("native-sheet").props.sheetGesturesEnabled).toBe(false);
    expect(view.getByTestId("native-sheet").props.properties.shouldDismissOnBackPress).toBe(false);
  });
});
