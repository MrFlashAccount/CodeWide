import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { getItemAsync, setItemAsync } from "expo-secure-store";
import { reloadAsync } from "expo-updates";
import { UiGenerationControl } from "../src/boot/UiGenerationControl";
import { activateRuntime, stopRuntime } from "../src/boot/runtimeSlot";
import { subscribeUiGeneration, uiGenerationSnapshot } from "../src/boot/uiGenerationResource";

// WHY: SecureStore and application restart need a device. Keep the real
// generation selection and runtime lifecycle; replace only native I/O.
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));
jest.mock("expo-updates", () => ({ reloadAsync: jest.fn(async () => undefined) }));

beforeEach(() => jest.clearAllMocks());
afterEach(async () => { await stopRuntime("legacy"); await stopRuntime("v2"); });

it("offers no generation switch or Modern entry from Legacy", () => {
  const view = render(<UiGenerationControl current="legacy" />);
  expect(view.queryAllByRole("switch")).toHaveLength(0);
  expect(view.queryByText("Modern")).toBeNull();
  expect(view.queryAllByRole("button")).toHaveLength(0);
});

it("lets an already mounted Modern session return only to Legacy", async () => {
  const stopped = jest.fn();
  await activateRuntime("v2", () => ({ stop: stopped }));
  const view = render(<UiGenerationControl current="v2" />);
  expect(view.queryAllByRole("switch")).toHaveLength(0);
  fireEvent.press(view.getByLabelText("Return to Legacy"));
  await waitFor(() => expect(reloadAsync).toHaveBeenCalledTimes(1));
  expect(setItemAsync).toHaveBeenCalledWith(expect.any(String), "legacy");
  expect(stopped).toHaveBeenCalledTimes(1);
  expect(jest.mocked(setItemAsync).mock.invocationCallOrder[0]).toBeLessThan(stopped.mock.invocationCallOrder[0]!);
  expect(stopped.mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(reloadAsync).mock.invocationCallOrder[0]!);
});

it("disables repeat changes while switching and permits retry after failure", async () => {
  const pending = Promise.withResolvers<void>();
  jest.mocked(setItemAsync).mockReturnValueOnce(pending.promise);
  const view = render(<UiGenerationControl current="v2" />);
  fireEvent.press(view.getByLabelText("Return to Legacy"));
  expect(view.getByLabelText("Return to Legacy").props.accessibilityState.disabled).toBe(true);
  fireEvent.press(view.getByLabelText("Return to Legacy"));
  expect(setItemAsync).toHaveBeenCalledTimes(1);
  await act(async () => { pending.reject(new Error("storage unavailable")); });
  expect(view.getByText("The switch could not restart the app. Try again or reopen CodeWide.")).toBeTruthy();
  expect(view.getByLabelText("Return to Legacy").props.accessibilityState.disabled).toBe(false);
  expect(reloadAsync).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText("Return to Legacy"));
  await waitFor(() => expect(reloadAsync).toHaveBeenCalledTimes(1));
});

it("boots Legacy even when Modern was saved before this build", async () => {
  jest.mocked(getItemAsync).mockResolvedValueOnce("v2");
  const unsubscribe = subscribeUiGeneration(() => undefined);
  try {
    await waitFor(() => expect(uiGenerationSnapshot()).toEqual({ status: "ready", generation: "legacy" }));
    expect(getItemAsync).toHaveBeenCalledTimes(1);
  } finally {
    unsubscribe();
  }
});
