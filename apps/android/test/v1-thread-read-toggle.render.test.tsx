import { act, renderHook } from "@testing-library/react-native";

import { useThreadListActions } from "../src/features/threadList/threadListActions";
import type { ThreadListMutations } from "../src/features/turnActions/turnActionCapabilities";
import type { ThreadListItem } from "../src/features/threadList/threadListTypes";

it("routes each visible read state to the opposite persisted action", async () => {
  const markThreadRead = jest.fn(async () => undefined);
  const markThreadUnread = jest.fn(async () => undefined);
  const remote: ThreadListMutations = {
    archiveThread: jest.fn(async () => undefined),
    markThreadRead,
    markThreadUnread,
    setThreadPinned: jest.fn(async () => undefined),
    unarchiveThread: jest.fn(async () => undefined),
  };
  const thread: ThreadListItem = {
    id: "thread",
    pinned: false,
    preview: "Preview",
    serverId: "server",
    title: "Thread",
    unread: 0,
  };
  const view = renderHook(() => useThreadListActions(remote, null, jest.fn()));

  await act(async () => {
    await view.result.current.toggleListThreadRead(thread);
    await view.result.current.toggleListThreadRead({ ...thread, unread: 1 });
  });

  expect(markThreadUnread).toHaveBeenCalledWith("server", "thread");
  expect(markThreadRead).toHaveBeenCalledWith("server", "thread");
  expect(markThreadUnread).toHaveBeenCalledTimes(1);
  expect(markThreadRead).toHaveBeenCalledTimes(1);
});
