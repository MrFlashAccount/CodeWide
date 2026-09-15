import { act, renderHook } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { useAccountLogin } from "../src/features/accounts/accountLogin";

function capabilities() {
  return {
    connectionId: "server",
    onStartLogin: jest.fn(async () => ({ loginId: "login", verificationUrl: "https://example.test/login", userCode: "1234" })),
    onCancelLogin: jest.fn(async () => undefined),
  };
}

afterEach(() => jest.useRealTimers());

it("cancels a login only through explicit close and keeps returned actions stable", async () => {
  const actions = capabilities();
  const { result, rerender, unmount } = renderHook(() => useAccountLogin(actions, "profile", jest.fn()));
  const addAccount = result.current.addAccount;
  await act(async () => addAccount());
  expect(result.current.pendingAccountLogin?.loginId).toBe("login");
  rerender({});
  expect(result.current.addAccount).toBe(addAccount);
  act(() => result.current.closeAccountLogin());
  expect(actions.onCancelLogin).toHaveBeenCalledWith("server", "login");
  expect(result.current.pendingAccountLogin).toBeNull();
  await act(async () => addAccount());
  unmount();
  expect(actions.onCancelLogin).toHaveBeenCalledTimes(1);
});

it("expires copied feedback and clears its timer on unmount without cancelling login", async () => {
  jest.useFakeTimers();
  const actions = capabilities();
  const copied = jest.spyOn(Clipboard, "setStringAsync");
  const scheduled = jest.spyOn(globalThis, "setTimeout");
  const cancelled = jest.spyOn(globalThis, "clearTimeout");
  const { result, unmount } = renderHook(() => useAccountLogin(actions, "profile", jest.fn()));
  await act(async () => result.current.addAccount());
  await act(async () => result.current.copyAccountCode());
  expect(copied).toHaveBeenCalledWith("1234");
  expect(result.current.codeCopied).toBe(true);
  act(() => jest.advanceTimersByTime(2_400));
  expect(result.current.codeCopied).toBe(false);
  await act(async () => result.current.copyAccountCode());
  const feedbackTimerIndex = scheduled.mock.calls.findLastIndex((call) => call[1] === 2_400);
  expect(feedbackTimerIndex).toBeGreaterThanOrEqual(0);
  const feedbackTimer = scheduled.mock.results[feedbackTimerIndex]?.value;
  unmount();
  expect(cancelled).toHaveBeenCalledWith(feedbackTimer);
  expect(actions.onCancelLogin).not.toHaveBeenCalled();
  copied.mockRestore();
  scheduled.mockRestore();
  cancelled.mockRestore();
});

it("hides completed login feedback when the profile snapshot changes", async () => {
  const actions = capabilities();
  const { result, rerender } = renderHook(({ profiles }) => useAccountLogin(actions, profiles, jest.fn()), { initialProps: { profiles: "before" } });
  await act(async () => result.current.addAccount());
  rerender({ profiles: "before|new-account" });
  expect(result.current.pendingAccountLogin).toBeNull();
  expect(actions.onCancelLogin).not.toHaveBeenCalled();
});
