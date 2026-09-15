import { act, renderHook } from "@testing-library/react-native";
import { useAttachmentVisibility } from "../src/features/attachments/attachmentVisibility";

it("opens the attachment sheet immediately while its lower resource request remains pending", async () => {
  let reject: (error: Error) => void = () => undefined;
  const response = new Promise<never>((_resolve, fail) => { reject = fail; });
  const load = jest.fn(() => response);
  const dismiss = jest.fn();
  const changes = jest.fn();
  const hook = renderHook(({ scope }) => useAttachmentVisibility(scope, dismiss, load, changes), { initialProps: { scope: "first" } });
  const open = hook.result.current.openThreadResources;
  act(() => open("attachments"));
  expect(hook.result.current.threadResourceSheet).toBe("attachments");
  expect(load).toHaveBeenCalledWith(undefined, "attachments");
  expect(dismiss).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("Offline")));
  expect(hook.result.current.threadResourceSheet).toBe("attachments");
  act(() => hook.result.current.closeThreadResources());
  expect(hook.result.current.threadResourceSheet).toBeNull();
  act(() => open("changes"));
  expect(changes).toHaveBeenCalledTimes(1);
  expect(hook.result.current.threadResourceSheet).toBeNull();
  expect(load).toHaveBeenCalledTimes(1);
  act(() => open("attachments"));
  hook.rerender({ scope: "second" });
  expect(hook.result.current.threadResourceSheet).toBeNull();
  expect(hook.result.current.openThreadResources).toBe(open);
});
