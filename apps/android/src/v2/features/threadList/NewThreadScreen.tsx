import { router } from "expo-router";

import type { SavedServerId } from "../../domain/ids";
import { threadId } from "../../domain/ids";
import { qualifiedThread } from "../../domain/qualifiedThread";
import { threadDestination } from "../navigation/routeDestinations";
import { NewThreadForm } from "./NewThreadForm";
import { useEvent } from "../../../react/useEvent";

interface NewThreadScreenProps {
  savedServerId: SavedServerId;
}

export function NewThreadScreen({ savedServerId }: NewThreadScreenProps): React.JSX.Element {
  const openThread = useEvent((createdThreadId: string) => {
    router.replace(threadDestination(qualifiedThread(savedServerId, threadId(createdThreadId))));
  });
  return <NewThreadForm onThreadCreated={openThread} savedServerId={savedServerId} />;
}
