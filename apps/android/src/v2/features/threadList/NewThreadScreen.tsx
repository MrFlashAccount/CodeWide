import { router } from "expo-router";

import type { SavedServerId } from "../../domain/ids";
import { threadId } from "../../domain/ids";
import { qualifiedThread } from "../../domain/qualifiedThread";
import { portsDestination, threadDestination } from "../navigation/routeDestinations";
import { NewThreadForm, type NewThreadComposerAction } from "./NewThreadForm";
import { useEvent } from "../../../react/useEvent";

interface NewThreadScreenProps {
  savedServerId: SavedServerId;
}

export function NewThreadScreen(props: NewThreadScreenProps): React.JSX.Element {
  const { savedServerId } = props;
  const close = useEvent(() => router.back());
  const openThread = useEvent((createdThreadId: string) => {
    router.replace(threadDestination(qualifiedThread(savedServerId, threadId(createdThreadId))));
  });
  const openComposerAction = useEvent((action: NewThreadComposerAction): void => {
    if (action === "ports") router.push(portsDestination(savedServerId));
  });
  return (
    <NewThreadForm
      onBack={close}
      onComposerAction={openComposerAction}
      onThreadCreated={openThread}
      savedServerId={savedServerId}
    />
  );
}
