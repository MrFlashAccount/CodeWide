import { useState } from "react";

import { useEvent } from "../../../react/useEvent";
import type { SavedServerId } from "../../domain/ids";
import { InlineQueueView } from "../../presentation/queue/InlineQueueView";
import { QueueSheetView } from "../../presentation/queue/QueueSheetView";
import { QueueFeatureBoundary, type QueueFeatureModel } from "./QueueFeatureBoundary";
import { QueueEditorFeature } from "./QueueEditorFeature";

export interface QueueControlsFeatureProps {
  activeTurnId: string | null;
  mutationsEnabled?: boolean;
  savedServerId: SavedServerId;
  threadId: string;
}

/** Renders one inline authoritative queue summary and its manager sheet. */
export function QueueControlsFeature(props: QueueControlsFeatureProps): React.JSX.Element {
  const { activeTurnId, mutationsEnabled = true, savedServerId, threadId } = props;
  const [visible, setVisible] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const open = useEvent(() => setVisible(true));
  const close = useEvent(() => {
    setEditingItemId(null);
    setVisible(false);
  });
  const cancelEdit = useEvent(() => setEditingItemId(null));
  const requestEdit = useEvent((itemId: string) => setEditingItemId(itemId));
  const renderQueue = (model: QueueFeatureModel) => {
    const item = model.items.find((candidate) => candidate.id === editingItemId);
    const editor =
      item === undefined ? null : (
        <QueueEditorFeature
          actions={model.actions}
          disabled={!model.actionable}
          item={item}
          onCancel={cancelEdit}
          savedServerId={savedServerId}
          threadId={threadId}
        />
      );
    return (
      <>
        <InlineQueueView
          hasMore={model.paging.status !== "complete"}
          items={model.items}
          onOpen={open}
        />
        <QueueSheetView
          actionable={model.actionable}
          actions={model.actions}
          activeTurnId={activeTurnId}
          editingItemId={editingItemId}
          editor={editor}
          items={model.items}
          onClose={close}
          onEditRequest={requestEdit}
          paging={model.paging}
          visible={visible}
        />
      </>
    );
  };
  return (
    <QueueFeatureBoundary
      activeTurnId={activeTurnId}
      mutationsEnabled={mutationsEnabled}
      savedServerId={savedServerId}
      threadId={threadId}
    >
      {renderQueue}
    </QueueFeatureBoundary>
  );
}
