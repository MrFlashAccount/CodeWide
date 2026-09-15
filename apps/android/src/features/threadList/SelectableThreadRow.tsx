import { useSelector } from "@legendapp/state/react";
import { type ThreadNavigationModel } from "../navigation/threadNavigation";
import { threadSelectionKey } from "../navigation/threadSelection";
import { ThreadRow } from "./ThreadRow";

export function SelectableThreadRow({
  navigation,
  thread,
  ...row
}: Omit<Parameters<typeof ThreadRow>[0], "selected"> & {
  navigation: ThreadNavigationModel;
}) {
  const selectionKey = threadSelectionKey(thread);
  const selected = useSelector(() => navigation.selection$.id.get() === selectionKey);
  return <ThreadRow {...row} thread={thread} selected={selected} />;
}
