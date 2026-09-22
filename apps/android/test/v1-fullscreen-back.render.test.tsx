import { act, fireEvent, render } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { BackHandler, Pressable, Text } from "react-native";

import {
  AppFullscreenOverlayHost,
  AppFullscreenOverlayProvider,
  useAppFullscreenOverlay,
} from "../src/ui/AppFullscreenOverlay";

// WHY: Compose windows cannot run in Node; retain their native dismissal callback.
jest.mock("@expo/ui/jetpack-compose", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const Slot = ({ children }: { children?: ReactNode }) => <View>{children}</View>;
  return {
    Host: Slot,
    RNHostView: Slot,
    BasicAlertDialog: ({
      children,
      onDismissRequest,
    }: {
      children?: ReactNode;
      onDismissRequest: () => void;
    }) => (
      <View testID="fullscreen-window" onDismissRequest={onDismissRequest}>
        {children}
      </View>
    ),
  };
});

// WHY: Window styling and Android bridge configuration do not participate in Back dispatch.
jest.mock("@expo/ui/jetpack-compose/modifiers", () => ({
  background: () => ({}),
  fillMaxSize: () => ({}),
}));
jest.mock("../src/native/native-transport", () => ({
  configureNativeFullscreenWindow: jest.fn(),
}));
jest.mock("react-native-safe-area-context", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return { SafeAreaProvider: View, SafeAreaView: View };
});

function PreviewLauncher({ onClose }: { readonly onClose: () => void }) {
  const overlay = useAppFullscreenOverlay({ lifecycle: { didClose: onClose } });
  return (
    <Pressable
      onPress={() => {
        overlay.present(() => <Text>README preview</Text>);
      }}
    >
      <Text>Open Markdown</Text>
    </Pressable>
  );
}

function Harness({ onClose }: { readonly onClose: () => void }) {
  return (
    <AppFullscreenOverlayProvider>
      <PreviewLauncher onClose={onClose} />
      <AppFullscreenOverlayHost />
    </AppFullscreenOverlayProvider>
  );
}

type BackListener = () => boolean | null | undefined;
let backListeners: BackListener[] = [];
const underlyingBack = jest.fn(() => false);

beforeEach(() => {
  underlyingBack.mockClear();
  backListeners = [underlyingBack];
  jest.spyOn(BackHandler, "addEventListener").mockImplementation((_event, listener) => {
    backListeners.push(listener);
    return {
      remove: () => {
        backListeners = backListeners.filter((candidate) => candidate !== listener);
      },
    };
  });
});
afterEach(() => jest.restoreAllMocks());

function pressSystemBack(): boolean {
  for (let index = backListeners.length - 1; index >= 0; index -= 1) {
    if (backListeners[index]?.()) return true;
  }
  return false;
}

it("consumes Activity Back for only the top preview and releases it after the final close", () => {
  const onClose = jest.fn();
  const view = render(<Harness onClose={onClose} />);
  fireEvent.press(view.getByText("Open Markdown"));
  fireEvent.press(view.getByText("Open Markdown"));

  act(() => {
    expect(pressSystemBack()).toBe(true);
  });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(view.getByText("README preview")).toBeVisible();
  expect(underlyingBack).not.toHaveBeenCalled();

  act(() => {
    expect(pressSystemBack()).toBe(true);
  });
  expect(onClose).toHaveBeenCalledTimes(2);
  expect(view.queryByText("README preview")).toBeNull();
  expect(underlyingBack).not.toHaveBeenCalled();

  act(() => {
    expect(pressSystemBack()).toBe(false);
  });
  expect(underlyingBack).toHaveBeenCalledTimes(1);
});

it("retains native dialog dismissal and removes the fallback on unmount", () => {
  const onClose = jest.fn();
  const view = render(<Harness onClose={onClose} />);
  fireEvent.press(view.getByText("Open Markdown"));
  fireEvent(view.getByTestId("fullscreen-window"), "dismissRequest");
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(view.queryByText("README preview")).toBeNull();
  fireEvent.press(view.getByText("Open Markdown"));
  view.unmount();

  act(() => {
    expect(pressSystemBack()).toBe(false);
  });
  expect(underlyingBack).toHaveBeenCalledTimes(1);
});
