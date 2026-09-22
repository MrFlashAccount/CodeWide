import { AppState } from "react-native";

const mockUpdates = {
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  isEnabled: true,
  reloadAsync: jest.fn(),
};
jest.mock("expo-updates", () => mockUpdates);
jest.mock("../src/observability/logger", () => ({ appLogger: { warn: jest.fn() } }));

const originalDevelopment = __DEV__;
const originalAppState = AppState.currentState;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  global.__DEV__ = false;
  AppState.currentState = "active";
  mockUpdates.checkForUpdateAsync.mockResolvedValue({ isAvailable: true });
  mockUpdates.fetchUpdateAsync.mockResolvedValue({ isNew: true });
  jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove: jest.fn() });
});

afterEach(() => {
  global.__DEV__ = originalDevelopment;
  AppState.currentState = originalAppState;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function startPrefetch() {
  jest.isolateModules(() => {
    const runtime = jest.requireActual<typeof import("../src/data/use-ota-prefetch")>(
      "../src/data/use-ota-prefetch",
    );
    runtime.startOtaPrefetchRuntime();
    runtime.startOtaPrefetchRuntime();
  });
}

it("downloads an update without interrupting the current runtime or reloading on foreground", async () => {
  const download = Promise.withResolvers<{ isNew: boolean }>();
  mockUpdates.fetchUpdateAsync.mockReturnValue(download.promise);
  startPrefetch();
  expect(mockUpdates.checkForUpdateAsync).not.toHaveBeenCalled();

  await jest.advanceTimersByTimeAsync(30_000);
  expect(mockUpdates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(30_000);
  expect(mockUpdates.checkForUpdateAsync).toHaveBeenCalledTimes(1);

  download.resolve({ isNew: true });
  await jest.advanceTimersByTimeAsync(0);
  const onAppState = jest.mocked(AppState.addEventListener).mock.calls[0]?.[1];
  expect(onAppState).toBeDefined();
  onAppState?.("active");
  await jest.advanceTimersByTimeAsync(30_000);
  expect(mockUpdates.reloadAsync).not.toHaveBeenCalled();
});

it("retries failed downloads and throttles successful checks without activating a rollback", async () => {
  mockUpdates.fetchUpdateAsync
    .mockRejectedValueOnce(new Error("Network unavailable"))
    .mockResolvedValue({ isNew: false, isRollBackToEmbedded: true });
  startPrefetch();
  await jest.advanceTimersByTimeAsync(30_000);
  await jest.advanceTimersByTimeAsync(30_000);
  expect(mockUpdates.fetchUpdateAsync).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(mockUpdates.checkForUpdateAsync).toHaveBeenCalledTimes(2);
  expect(mockUpdates.reloadAsync).not.toHaveBeenCalled();
});

it("does not check for updates while the application is in the background", async () => {
  AppState.currentState = "background";
  startPrefetch();
  await jest.advanceTimersByTimeAsync(60_000);
  expect(mockUpdates.checkForUpdateAsync).not.toHaveBeenCalled();
  expect(mockUpdates.reloadAsync).not.toHaveBeenCalled();
});
