import { useState, useSyncExternalStore } from "react";

import { useEvent } from "../../../react/useEvent";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ResourceStateView } from "../../presentation/feedback/ResourceStateView";
import { ItemOutputViewer } from "./ItemOutputViewer";
import { ItemOutputResource } from "./itemOutputResource";

interface ItemOutputScreenProps {
  copyText(value: string): Promise<void>;
  itemId: string;
  onClose(): void;
  owner: QualifiedThread;
  turnId: string;
}

/** Owns initial loading and retry for one full-output route. */
export function ItemOutputScreen(props: ItemOutputScreenProps): React.JSX.Element {
  const { copyText, itemId, onClose, owner, turnId } = props;
  const runtime = useV2Runtime();
  const [resource] = useState(
    () => new ItemOutputResource({ itemId, owner, queries: runtime.queries, turnId }),
  );
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const retry = useEvent(() => resource.refresh());
  const loadPage = useEvent((requestedTurnId: string, requestedItemId: string, cursor: string) => {
    if (requestedTurnId !== turnId || requestedItemId !== itemId)
      throw new Error("Full-output owner changed");
    return resource.loadPage(cursor);
  });
  if (snapshot.value === null) {
    return (
      <ResourceStateView
        message={snapshot.status === "error" ? snapshot.message : "Opening full output…"}
        onRetry={retry}
        status={snapshot.status === "error" ? "error" : "loading"}
      />
    );
  }
  return (
    <ItemOutputViewer
      copyText={copyText}
      initialPage={snapshot.value}
      itemId={itemId}
      loadPage={loadPage}
      onClose={onClose}
      turnId={turnId}
    />
  );
}
