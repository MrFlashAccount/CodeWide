import { act, fireEvent, render } from "@testing-library/react-native";

import V1NewServerRoute from "../app/(workspace)/settings/servers/new";
import { mockRouterHistory, resetMockRouter, router } from "./mocks/ExpoRouter";

jest.mock("../src/features/connections/ConnectionSheet", () => ({
  ConnectionSheet: ({ onClose }: { readonly onClose: () => void }) => {
    const { Pressable, Text } = require("react-native");
    return (
      <Pressable onPress={onClose} testID="dismiss-pairing">
        <Text>Dismiss pairing</Text>
      </Pressable>
    );
  },
}));

jest.mock("../src/services/workspace/workspaceRouteResources", () => ({
  useWorkspaceRouteResources: () => ({
    connectionActions: { saveConnection: jest.fn() },
    runtime: { error: null, ready: true },
  }),
}));

afterEach(() => {
  resetMockRouter();
});

it.each(["/", "/settings"])(
  "dismisses pairing to its %s origin and allows opening it again",
  (origin) => {
    resetMockRouter(origin);
    act(() => router.push("/settings/servers/new"));
    const first = render(<V1NewServerRoute />);

    fireEvent.press(first.getByTestId("dismiss-pairing"));
    expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual([origin]);
    // Native sheet dismissal can deliver a second close event before the route unmounts.
    fireEvent.press(first.getByTestId("dismiss-pairing"));
    expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual([origin]);
    first.unmount();

    act(() => router.push("/settings/servers/new"));
    const second = render(<V1NewServerRoute />);
    fireEvent.press(second.getByTestId("dismiss-pairing"));
    expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual([origin]);
    second.unmount();
  },
);

it("closes a direct pairing entry to the welcome route", () => {
  resetMockRouter("/settings/servers/new");
  const view = render(<V1NewServerRoute />);

  fireEvent.press(view.getByTestId("dismiss-pairing"));
  expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual(["/"]);
  view.unmount();
});
