import { act, renderHook } from "@testing-library/react-native";
import { useAttachmentVisibility } from "../src/features/attachments/attachmentVisibility";

it("opens the attachment sheet immediately while its lower resource request remains pending", async () => {
  const pending = Promise.withResolvers<never>();
  const response = pending.promise;
  const load = jest.fn(() => response);
  const dismiss = jest.fn();
  const changes = jest.fn();
  const attachments = jest.fn();
  const hook = renderHook(() => useAttachmentVisibility(dismiss, load, changes, attachments));
  const open = hook.result.current.openThreadResources;
  act(() => open("attachments"));
  expect(load).toHaveBeenCalledWith(undefined, "attachments");
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(attachments).toHaveBeenCalledTimes(1);
  await act(async () => pending.reject(new Error("Offline")));
  act(() => open("changes"));
  expect(changes).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledTimes(1);
  expect(hook.result.current.openThreadResources).toBe(open);
});
