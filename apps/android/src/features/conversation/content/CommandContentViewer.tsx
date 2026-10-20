import { useSelector } from "@legendapp/state/react";
import type { ThreadItem } from "@codewide/codex-protocol/v0.155.1/v2";
import type { ThreadDetailDatabase } from "../../../data/thread-detail-database";
import type { CommandContentRouteRequest } from "../../../services/content/contentRouteSession";
import { ActivityContentViewer } from "./ActivityContentViewer";

/** Projects one exact command item from the live thread model into the output viewer. */
export function CommandContentViewer({
  connectionId,
  database,
  onClose,
  request,
  threadId,
}: {
  readonly connectionId: string;
  readonly database: ThreadDetailDatabase | null;
  readonly onClose: () => void;
  readonly request: CommandContentRouteRequest;
  readonly threadId: string;
}): React.JSX.Element {
  useSelector(() => database?.chat.window$(connectionId, threadId).revision.get() ?? 0);
  const current = database
    ?.getThread(connectionId, threadId)
    ?.turns.find((turn) => turn.id === request.turnId)
    ?.items.find(
      (item): item is Extract<ThreadItem, { type: "commandExecution" }> =>
        item.id === request.itemId && item.type === "commandExecution",
    );
  const output = current?.aggregatedOutput ?? request.fallbackOutput;
  return (
    <ActivityContentViewer
      onClose={onClose}
      presentation="terminal"
      text={output}
      title={request.title}
    />
  );
}
