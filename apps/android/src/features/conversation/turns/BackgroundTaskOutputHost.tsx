import type { ReactElement, ReactNode } from "react";
import type { BackgroundTaskOutputPage } from "../../../data/backgroundTaskOutput";
import { useEvent } from "../../../react/useEvent";
import { useConversationRouteNavigation } from "../conversationRouteNavigation";
import { BackgroundTaskContext, type OpenableBackgroundTask } from "./turnContexts";

type ReadPage = (taskId: string, offset: number) => Promise<BackgroundTaskOutputPage>;

/**
 * Lets a conversation open a background task's output: its first page is
 * read before the output screen opens, so a failure stays where the person
 * pressed. The screen (`BackgroundTaskOutputScreen`) reads the rest.
 */
export function BackgroundTaskOutputHost({
  children,
  read,
}: {
  readonly children: ReactNode;
  readonly read: ReadPage | undefined;
}): ReactElement {
  const navigation = useConversationRouteNavigation();
  const openTask = useEvent(async (task: OpenableBackgroundTask): Promise<void> => {
    if (read === undefined) {
      return;
    }
    const first = await read(task.taskId, 0);
    navigation.openTaskOutput({ first, name: task.name, read, taskId: task.taskId });
  });
  return (
    <BackgroundTaskContext.Provider value={read === undefined ? null : openTask}>
      {children}
    </BackgroundTaskContext.Provider>
  );
}
