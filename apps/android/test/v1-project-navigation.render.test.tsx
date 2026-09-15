// WHY: Node has no Android IME; only the external keyboard bridge is replaced.
jest.mock("react-native-keyboard-controller", () => ({ KeyboardController: { dismiss: jest.fn() } }));
import { KeyboardController } from "react-native-keyboard-controller";
import { threadSelectionKey } from "../src/features/navigation/threadSelection";
import { act, renderHook } from "@testing-library/react-native";
import { createThreadNavigationModel } from "../src/features/navigation/threadNavigation";
import { useThreadNavigationActions } from "../src/features/navigation/navigationActions";
import { useComposerProjectSelection } from "../src/features/projects/composerProjectSelection";
import { useConversationOwner } from "../src/ui/use-conversation-owner";

function pending() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

it("publishes main-chat selection before observer hydration settles and retains stable intents", async () => {
  const observation = pending();
  const navigation = createThreadNavigationModel();
  const observeThread = jest.fn(() => observation.promise);
  const selectServer = jest.fn();
  const { result, rerender } = renderHook(() => useThreadNavigationActions({
    native: false,
    threadDetails: null,
    threadUiStateDatabase: null,
    observeThread,
    searchConversation: async () => ({ messages: [], turns: [], older: null, newer: null }),
  }, navigation, selectServer));
  const select = result.current.selectThread;
  const key = threadSelectionKey({ serverId: "server", id: "chat" });
  act(() => select(key));
  expect(navigation.current().id).toBe(key);
  expect(observeThread).toHaveBeenCalledWith("server", "chat");
  expect(selectServer).not.toHaveBeenCalled();
  expect(KeyboardController.dismiss).toHaveBeenCalledWith({ animated: false, keepFocus: false });
  rerender({});
  expect(result.current.selectThread).toBe(select);
  await act(async () => observation.resolve());
  expect(navigation.current().id).toBe(key);
});

it("ignores project completion from a replaced conversation activation", async () => {
  const change = pending();
  const onChange = jest.fn(() => change.promise);
  const { result, rerender } = renderHook(({ scope }) => {
    const owner = useConversationOwner(scope);
    return useComposerProjectSelection(scope, onChange, jest.fn(), owner);
  }, { initialProps: { scope: "first" } });
  act(() => result.current.openProjectPicker());
  let completion: Promise<void> = Promise.resolve();
  act(() => { completion = result.current.selectProject("/project"); });
  expect(result.current.projectChangeBusy).toBe(true);
  rerender({ scope: "second" });
  act(() => result.current.openProjectPicker());
  expect(result.current.projectPickerVisible).toBe(true);
  expect(result.current.projectChangeBusy).toBe(false);
  await act(async () => { change.resolve(); await completion; });
  expect(result.current.projectPickerVisible).toBe(true);
  expect(result.current.projectChangeBusy).toBe(false);
  expect(result.current.projectChangeError).toBeNull();
});
