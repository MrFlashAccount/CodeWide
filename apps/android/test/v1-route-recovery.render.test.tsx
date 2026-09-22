import { Suspense, use } from "react";
import { Text, View } from "react-native";
import { act, fireEvent, render, renderAsync } from "@testing-library/react-native";

import UnmatchedRoute from "../app/+not-found";
import { ThreadListSuspenseFallback } from "../src/features/threadList/ThreadListBoundary";
import { resetMockRouter, router } from "./mocks/ExpoRouter";

afterEach(() => {
  resetMockRouter();
  jest.restoreAllMocks();
});

it("shows a loading surface immediately when the thread list suspends and then reveals content", async () => {
  const pending = Promise.withResolvers<string>();
  function PendingList() {
    return <Text>{use(pending.promise)}</Text>;
  }
  const view = await renderAsync(
    <View>
      <Suspense fallback={<ThreadListSuspenseFallback />}>
        <PendingList />
      </Suspense>
    </View>,
  );
  expect(view.getByLabelText("Loading threads")).toBeVisible();
  await act(async () => {
    pending.resolve("Thread list ready");
    await pending.promise;
  });
  expect(view.getByText("Thread list ready")).toBeVisible();
  expect(view.queryByLabelText("Loading threads")).toBeNull();
});

it("keeps an explicit way home visible while an unmatched-route redirect is pending", () => {
  resetMockRouter("/obsolete/thread");
  const replace = jest.spyOn(router, "replace").mockImplementation(() => undefined);
  const view = render(<UnmatchedRoute />);
  expect(replace).toHaveBeenCalledWith("/");
  expect(view.getByText("Page unavailable")).toBeVisible();
  replace.mockClear();
  fireEvent.press(view.getByRole("button", { name: "Open threads" }));
  expect(replace).toHaveBeenCalledWith("/");
});
