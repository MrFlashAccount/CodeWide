import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { type ReactNode } from "react";

import { CodeBlock } from "../src/rendering/CodeBlock";
import {
  AppFullscreenOverlayHost,
  AppFullscreenOverlayProvider,
} from "../src/ui/AppFullscreenOverlay";

// WHY: Compose windows cannot run in Node; retain only their child and dismissal contracts.
jest.mock("@expo/ui/jetpack-compose", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const Slot = ({ children }: { readonly children?: ReactNode }) => <View>{children}</View>;
  return { BasicAlertDialog: Slot, Host: Slot, RNHostView: Slot };
});
jest.mock("@expo/ui/jetpack-compose/modifiers", () => ({
  background: () => ({}),
  fillMaxSize: () => ({}),
}));
jest.mock("../src/native/native-transport", () => ({
  configureNativeFullscreenWindow: jest.fn(),
}));
// WHY: Insets are supplied by the native fullscreen window, which the Node renderer does not own.
jest.mock("react-native-safe-area-context", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    SafeAreaProvider: View,
    SafeAreaView: ({ children }: { readonly children: ReactNode }) => <View>{children}</View>,
  };
});

function Harness(): ReactNode {
  return (
    <AppFullscreenOverlayProvider>
      <CodeBlock language="typescript" value={"const first = 1;\nconst second = 2;"} />
      <AppFullscreenOverlayHost />
    </AppFullscreenOverlayProvider>
  );
}

it("keeps copy and fullscreen actions outside the scrollable code viewport", async () => {
  const view = render(<Harness />);

  fireEvent.press(view.getByLabelText("Copy typescript code block"));
  await waitFor(() => expect(view.getByLabelText("Copied typescript code block")).toBeVisible());

  fireEvent.press(view.getByLabelText("Open code block fullscreen"));
  expect(view.getByTestId("fullscreen-code-block")).toBeVisible();
  expect(view.getByLabelText("Close code block")).toBeVisible();
  expect(view.getByLabelText("Copy code block")).toBeVisible();

  fireEvent.press(view.getByLabelText("Close code block"));
  expect(view.queryByTestId("fullscreen-code-block")).toBeNull();
});
