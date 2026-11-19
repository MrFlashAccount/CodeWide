import { useQueryClient } from "@tanstack/react-query";
import { useContext, type ReactNode } from "react";
import type { GetTransferAccess } from "../../../data/private-transfer";
import type { RunningBackgroundTask } from "../../../data/runningBackgroundTasks";
import { useEvent } from "../../../react/useEvent";
import type { ConversationTerminalCapabilities } from "../../terminal/conversationTerminalCapabilities";
import { useConversationRouteNavigation } from "../conversationRouteNavigation";
import { BackgroundTerminalsContext, RunningBackgroundTasksContext } from "./turnContexts";

/** Captures the exact conversation and process before opening its retained output window. */
export function BackgroundTerminalOutputHost({
  children,
  connectionId,
  getTransferAccess,
  readTerminalCommand,
  threadId,
}: {
  readonly children: ReactNode;
  readonly connectionId: string | null;
  readonly getTransferAccess: GetTransferAccess;
  readonly readTerminalCommand: ConversationTerminalCapabilities["readTerminalCommand"];
  readonly threadId: string | null;
}): React.JSX.Element {
  const navigation = useConversationRouteNavigation();
  const queryClient = useQueryClient();
  const tasks = useContext(RunningBackgroundTasksContext);
  const open = useEvent(
    async (
      process: Extract<RunningBackgroundTask, { readonly kind: "terminal" }>,
    ): Promise<void> => {
      if (connectionId === null || threadId === null || tasks === null) {
        throw new Error("Terminal output is unavailable");
      }
      navigation.openContent({
        command: process.command,
        connectionId,
        getTransferAccess,
        isRunning: async () => {
          const entries = await queryClient.query({ ...tasks, staleTime: 0 });
          return entries.some(
            (entry) =>
              entry.kind === "terminal" &&
              entry.processId === process.processId &&
              entry.itemId === process.itemId,
          );
        },
        itemId: process.itemId,
        kind: "backgroundTerminal",
        processId: process.processId,
        read: async (itemId, signal) =>
          readTerminalCommand({ connectionId, itemId, signal, threadId }),
        threadId,
      });
      await Promise.resolve();
    },
  );
  return (
    <BackgroundTerminalsContext.Provider value={open}>
      {children}
    </BackgroundTerminalsContext.Provider>
  );
}
