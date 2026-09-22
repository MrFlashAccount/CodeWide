import { fireEvent, render } from "@testing-library/react-native";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
  SheetBackProvider,
  SheetPageTransition,
  useSheetBackHandler,
  useSheetDismissController,
} from "../src/ui/sheetNavigation";
import { v1MobileRouteMotion } from "../src/ui/v1MobileRouteMotion";
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

it("keeps shared motion distances and timing aligned with the V1 native route contract", () => {
  const animationDirectory = join(__dirname, "../android/app/src/main/res/anim");
  const pushForeground = readFileSync(join(animationDirectory, "rns_fade_from_bottom.xml"), "utf8");
  const pushBackground = readFileSync(join(animationDirectory, "rns_no_animation_350.xml"), "utf8");
  const popForeground = readFileSync(join(animationDirectory, "rns_fade_to_bottom.xml"), "utf8");
  const popBackground = readFileSync(join(animationDirectory, "rns_no_animation_250.xml"), "utf8");

  for (const animation of [pushForeground, pushBackground, popForeground, popBackground]) {
    expect(animation).toContain(`android:duration="${v1MobileRouteMotion.durationMs}"`);
  }
  expect(pushForeground).toContain(
    `android:fromXDelta="${v1MobileRouteMotion.foregroundTravel.percent}%"`,
  );
  expect(popForeground).toContain(
    `android:toXDelta="${v1MobileRouteMotion.foregroundTravel.percent}%"`,
  );
  expect(pushBackground).toContain(
    `android:toXDelta="-${v1MobileRouteMotion.backgroundTravel.percent}%"`,
  );
  expect(popBackground).toContain(
    `android:fromXDelta="-${v1MobileRouteMotion.backgroundTravel.percent}%"`,
  );
});
