import {
  commitDrawingAttachment,
  quickdrawAttachmentName,
} from "../../application/drawing/drawingAttachment";
import type { ComposerAttachmentDraft } from "../../application/composer/composerAttachmentDraft";
import {
  DrawingWorkspaceView,
  type DrawingCommit,
  type DrawingSnapshot,
} from "../../presentation/drawing/DrawingWorkspaceView";
import { useEvent } from "../../../react/useEvent";

interface DrawingWorkspaceProps {
  draft: Pick<ComposerAttachmentDraft, "attachBytes" | "replaceBytes">;
  draftItemId: string | null;
  initialSnapshot: DrawingSnapshot | null;
  mode: "drawing" | "image-annotation";
  name?: string;
  now(): Date;
  onAttached(draftItemId: string): void;
  onClose(): void;
}

export interface DrawingWorkspaceRequest {
  draftItemId: string | null;
  initialSnapshot: DrawingSnapshot | null;
  mode: "drawing" | "image-annotation";
  name?: string;
}

export type DrawingWorkspacePresenter = (request: DrawingWorkspaceRequest) => void;

/** Owns QuickDraw export-to-upload without coupling the presentation surface to transport. */
export function DrawingWorkspace(props: DrawingWorkspaceProps): React.JSX.Element {
  const { draft, draftItemId, initialSnapshot, mode, name, now, onAttached, onClose } = props;
  const commit = useEvent(async (value: DrawingCommit): Promise<boolean> => {
    const timestamp = now();
    const committedItemId = await commitDrawingAttachment(draft, {
      draftItemId,
      mode,
      name: name ?? quickdrawAttachmentName(timestamp),
      pngDataUrl: value.pngDataUrl,
      revision: timestamp.getTime(),
      snapshot: value.snapshot,
    });
    onAttached(committedItemId);
    return true;
  });
  return (
    <DrawingWorkspaceView
      editing={draftItemId !== null}
      initialSnapshot={initialSnapshot}
      mode={mode}
      onClose={onClose}
      onCommit={commit}
    />
  );
}
