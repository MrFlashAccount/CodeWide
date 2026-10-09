import { act, fireEvent, render } from "@testing-library/react-native";
import { useEffect } from "react";
import { DeviceEventEmitter, Dimensions, Text, View } from "react-native";
import { BrowserSheet } from "../src/features/browser/BrowserSheet.native";

jest.mock("../src/native/BrowserSheetContent", () => {
  const Native = jest.requireActual<typeof import("react-native")>("react-native");
  return { BrowserSheetContent: Native.View };
});
jest.mock("../src/native/browserSheetCapabilities", () => ({ browserSheetContentAvailable: true }));
jest.mock("@expo/ui/jetpack-compose", () => {
  const Native = jest.requireActual<typeof import("react-native")>("react-native");
  function ModalBottomSheet(props: object) {
    return <Native.View {...props} testID="native-browser-sheet" />;
  }
  ModalBottomSheet.DragHandle = Native.View;
  return { Host: Native.View, ModalBottomSheet, RNHostView: Native.View };
});

it("opens fully at phone and wide-screen widths and keeps the entire body behind one boundary", () => {
  const view = render(
    <BrowserSheet active onCollapse={jest.fn()} presentationId="first">
      <View testID="page">
        <Text>Page, Home and Tabs</Text>
      </View>
    </BrowserSheet>,
  );
  expect(view.getByTestId("native-browser-sheet").props).toMatchObject({
    visible: true,
    skipPartiallyExpanded: true,
    sheetGesturesEnabled: true,
    properties: { shouldDismissOnClickOutside: false },
  });
  expect(view.getByTestId("browser-sheet").findByProps({ testID: "page" })).toBeTruthy();
  expect(
    view.getByTestId("browser-sheet").findAllByProps({ testID: "browser-sheet-handle" }),
  ).toHaveLength(0);
  act(() =>
    Dimensions.set({
      window: { width: 1000, height: 600, scale: 1, fontScale: 1 },
      screen: { width: 1000, height: 600, scale: 1, fontScale: 1 },
    }),
  );
  expect(view.getByTestId("native-browser-sheet").props.maxWidth).toBe(1000);
});

it("collapses and reopens without dropping children, ignores stale dismissals and offers accessible collapse", () => {
  const mounted = jest.fn();
  const unmounted = jest.fn();
  const collapse = jest.fn();
  function Page() {
    useEffect(() => {
      mounted();
      return unmounted;
    }, []);
    return <Text>Live page</Text>;
  }
  const view = render(
    <BrowserSheet active onCollapse={collapse} presentationId="first">
      <Page />
    </BrowserSheet>,
  );
  fireEvent(view.getByTestId("native-browser-sheet"), "dismissRequest", {
    nativeEvent: { value: "first" },
  });
  expect(collapse).toHaveBeenCalledTimes(1);
  view.rerender(
    <BrowserSheet active={false} onCollapse={collapse} presentationId="first">
      <Page />
    </BrowserSheet>,
  );
  expect(view.getByTestId("native-browser-sheet").props.visible).toBe(false);
  view.rerender(
    <BrowserSheet active onCollapse={collapse} presentationId="second">
      <Page />
    </BrowserSheet>,
  );
  fireEvent(view.getByTestId("native-browser-sheet"), "dismissRequest", {
    nativeEvent: { value: "first" },
  });
  expect(collapse).toHaveBeenCalledTimes(1);
  fireEvent(view.getByLabelText("Browser sheet handle"), "accessibilityAction", {
    nativeEvent: { actionName: "collapse" },
  });
  expect(collapse).toHaveBeenCalledTimes(2);
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(unmounted).not.toHaveBeenCalled();
});

it("hands native Back to the existing browser handlers without dismissing from an obsolete presentation", () => {
  const back = jest.fn();
  const subscription = DeviceEventEmitter.addListener("hardwareBackPress", back);
  try {
    const view = render(
      <BrowserSheet active onCollapse={jest.fn()} presentationId="current">
        <Text>Page</Text>
      </BrowserSheet>,
    );
    fireEvent(view.getByTestId("native-browser-sheet"), "backPress", {
      nativeEvent: { value: "old" },
    });
    expect(back).not.toHaveBeenCalled();
    fireEvent(view.getByTestId("native-browser-sheet"), "backPress", {
      nativeEvent: { value: "current" },
    });
    expect(back).toHaveBeenCalledTimes(1);
  } finally {
    subscription.remove();
  }
});
