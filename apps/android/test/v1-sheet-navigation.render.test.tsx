import { fireEvent, render } from "@testing-library/react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
  SheetBackProvider,
  SheetPageTransition,
  useSheetBackHandler,
  useSheetDismissController,
} from "../src/ui/sheetNavigation";
import { useReducedMotionPreference } from "../src/rendering/reduced-motion-store";

// WHY: Exercise the motion contract without relying on the host OS accessibility preference.
jest.mock("../src/rendering/reduced-motion-store", () => ({
  useReducedMotionPreference: jest.fn(() => false),
}));

it("skips page motion when reduced motion is enabled", () => {
  jest.mocked(useReducedMotionPreference).mockReturnValueOnce(true);
  const view = render(
    <SheetPageTransition direction="forward" routeKey="detail">
      <Text>Detail</Text>
    </SheetPageTransition>,
  );
  expect(view.getByTestId("sheet-page:detail").props.entering).toBeUndefined();
  expect(view.getByTestId("sheet-page:detail").props.exiting).toBeUndefined();
});

function Detail({ close }: { readonly close: () => void }): React.JSX.Element {
  useSheetBackHandler(true, close);
  return <Text>Detail page</Text>;
}

function SheetNavigationHarness({ onClose }: { readonly onClose: () => void }): React.JSX.Element {
  const [detail, setDetail] = useState(false);
  const dismiss = useSheetDismissController(onClose);
  return (
    <SheetBackProvider register={dismiss.register}>
      <SheetPageTransition
        direction={detail ? "forward" : "back"}
        routeKey={detail ? "detail" : "root"}
      >
        <View>
          {detail ? (
            <Detail
              close={() => {
                setDetail(false);
              }}
            />
          ) : (
            <Pressable
              accessibilityLabel="Open detail"
              onPress={() => {
                setDetail(true);
              }}
            />
          )}
          <Pressable accessibilityLabel="System Back" onPress={dismiss.requestDismiss} />
        </View>
      </SheetPageTransition>
    </SheetBackProvider>
  );
}

it("handles Back inside the deepest sheet page before closing its sheet", () => {
  const onClose = jest.fn();
  const view = render(<SheetNavigationHarness onClose={onClose} />);

  fireEvent.press(view.getByLabelText("Open detail"));
  expect(view.getByText("Detail page")).toBeTruthy();
  expect(view.getByTestId("sheet-page:detail")).toBeTruthy();

  fireEvent.press(view.getByLabelText("System Back"));
  expect(view.queryByText("Detail page")).toBeNull();
  expect(view.getByTestId("sheet-page:root")).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();

  fireEvent.press(view.getByLabelText("System Back"));
  expect(onClose).toHaveBeenCalledTimes(1);
});
