import { act, renderHook } from "@testing-library/react-native";
import { KeyboardController } from "react-native-keyboard-controller";

import { useComposerProjectSelection } from "../src/features/projects/composerProjectSelection";
import {
  threadSelectionKey,
  v1ThreadRouteParams,
  type V1ThreadDestination,
  type V1ThreadRouteParams,
} from "../src/services/threads/threadRouteParams";
import { useThreadNavigationService } from "../src/services/threads/threadNavigationService";
import { useConversationOwner } from "../src/ui/use-conversation-owner";

function pending() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function routeParams(connectionId: string, threadId: string): V1ThreadRouteParams {
  const parsed = v1ThreadRouteParams({ connectionId, threadId });
  if (parsed.status === "invalid") throw new Error("Expected valid route parameters");
  return parsed.value;
}

it("publishes the qualified route before observer hydration settles and keeps stable intents", async () => {
  const observation = pending();
  const observeThread = jest.fn(() => observation.promise);
  const setActiveConnection = jest.fn();
  const current = { value: null as V1ThreadRouteParams | null };
  const push = jest.fn((destination: V1ThreadDestination) => {
    current.value = routeParams(destination.params.connectionId, destination.params.threadId);
  });
  const router = {
    get currentThread() {
      return current.value;
    },
    push,
    selectionMode: "push" as const,
    replace: jest.fn(),
    dismissToAll: jest.fn(),
  };
  const dismiss = jest.spyOn(KeyboardController, "dismiss");
  const { result, rerender } = renderHook(() =>
    useThreadNavigationService(
      {
        native: false,
        threadDetails: null,
        threadUiStateDatabase: null,
        observeThread,
        searchConversation: async () => ({ messages: [], turns: [], older: null, newer: null }),
      },
      router,
      setActiveConnection,
    ),
  );
  const select = result.current.selectThread;
  act(() => select(threadSelectionKey({ serverId: "server", id: "chat" })));
  expect(push).toHaveBeenCalledWith(
    {
      pathname: "/v1/threads/[connectionId]/[threadId]",
      params: { connectionId: "server", threadId: "chat" },
    },
    undefined,
  );
  expect(observeThread).toHaveBeenCalledWith("server", "chat");
  expect(setActiveConnection).toHaveBeenCalledWith("server");
  expect(dismiss).toHaveBeenCalledWith({ animated: false, keepFocus: false });
  rerender({});
  expect(result.current.selectThread).toBe(select);
  await act(async () => observation.resolve());
});

it("ignores project completion from a replaced conversation activation", async () => {
  const change = pending();
  const onChange = jest.fn(() => change.promise);
  const { result, rerender } = renderHook(
    ({ scope }) => {
      const owner = useConversationOwner(scope);
      return useComposerProjectSelection(scope, onChange, jest.fn(), owner);
    },
    { initialProps: { scope: "first" } },
  );
  act(() => result.current.openProjectPicker());
  let completion: Promise<void> = Promise.resolve();
  act(() => {
    completion = result.current.selectProject("/project");
  });
  expect(result.current.projectChangeBusy).toBe(true);
  rerender({ scope: "second" });
  act(() => result.current.openProjectPicker());
  expect(result.current.projectPickerVisible).toBe(true);
  expect(result.current.projectChangeBusy).toBe(false);
  await act(async () => {
    change.resolve();
    await completion;
  });
  expect(result.current.projectPickerVisible).toBe(true);
  expect(result.current.projectChangeBusy).toBe(false);
  expect(result.current.projectChangeError).toBeNull();
});
