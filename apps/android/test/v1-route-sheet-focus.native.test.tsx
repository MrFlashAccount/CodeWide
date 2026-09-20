import { render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { BrowserWorkspace } from "../src/features/browser/BrowserWorkspace";
import { AppFullscreenOverlayProvider } from "../src/ui/AppFullscreenOverlay";
import { AppSheet } from "../src/ui/AppSheet.android";

// WHY: Node cannot create the external Compose window; the real AppSheet lifecycle stays mounted.
jest.mock("@expo/ui/jetpack-compose", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View: NativeView } = jest.requireActual<typeof import("react-native")>("react-native");
  const hideNativeSheet = jest.fn(async () => undefined);
  const Host = ({ children }: { readonly children?: ReactNode }) => (
    <NativeView>{children}</NativeView>
  );
  const ModalBottomSheet = React.forwardRef(function MockModalBottomSheet(
    { children }: { readonly children?: ReactNode },
    ref,
  ) {
    React.useImperativeHandle(ref, () => ({ hide: hideNativeSheet }), []);
    return <NativeView testID="native-sheet">{children}</NativeView>;
  });
  return { hideNativeSheet, Host, ModalBottomSheet, RNHostView: Host };
});

afterEach(() => {
  jest.clearAllMocks();
});

it("hides a retained native sheet when its owning route loses focus", async () => {
  const contentProps = { dismissLabel: "Route sheet" };
  const view = render(
    <AppSheet contentProps={contentProps} isOpen onOpenChange={jest.fn()}>
      <View />
    </AppSheet>,
  );
  expect(view.getByTestId("native-sheet")).toBeVisible();

  view.rerender(
    <AppSheet contentProps={contentProps} isOpen={false} onOpenChange={jest.fn()}>
      <View />
    </AppSheet>,
  );

  await waitFor(() => {
    const compose = jest.requireMock("@expo/ui/jetpack-compose") as {
      readonly hideNativeSheet: jest.Mock;
    };
    expect(compose.hideNativeSheet).toHaveBeenCalledTimes(1);
  });
  await waitFor(() => {
    expect(view.queryByTestId("native-sheet")).toBeNull();
  });
});

it("lets the workspace shell own browser safe-area padding", () => {
  const view = render(
    <AppFullscreenOverlayProvider>
      <BrowserWorkspace
        onClose={jest.fn()}
        title="Development server"
        url="http://127.0.0.1:43000/"
      />
    </AppFullscreenOverlayProvider>,
  );
  const style = StyleSheet.flatten(view.getByTestId("browser-workspace").props.style);
  expect(style.paddingBottom).toBeUndefined();
  expect(style.paddingTop).toBeUndefined();
});
