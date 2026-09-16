import { threadSelectionKey } from "../../services/threads/threadRouteParams";
import { ThreadRow } from "./ThreadRow";

export function SelectableThreadRow({
  selectedThreadKey,
  thread,
  ...row
}: Omit<Parameters<typeof ThreadRow>[0], "selected"> & {
  selectedThreadKey: string | null;
}) {
  const selectionKey = threadSelectionKey(thread);
  const selected = selectedThreadKey === selectionKey;
  return <ThreadRow {...row} thread={thread} selected={selected} />;
}
