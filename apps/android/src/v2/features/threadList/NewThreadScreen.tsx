import { router } from "expo-router";

import type { SavedServerId } from "../../domain/ids";
import { threadId } from "../../domain/ids";
import { qualifiedThread } from "../../domain/qualifiedThread";
import { threadDestination } from "../navigation/routeDestinations";
import { NewThreadForm } from "./NewThreadForm";

export function NewThreadScreen({
  savedServerId,
}: {
  savedServerId: SavedServerId;
}): React.JSX.Element {
  return (
    <NewThreadForm
      onThreadCreated={(createdThreadId) => {
        router.replace(
          threadDestination(qualifiedThread(savedServerId, threadId(createdThreadId))),
        );
      }}
      savedServerId={savedServerId}
    />
  );
}
