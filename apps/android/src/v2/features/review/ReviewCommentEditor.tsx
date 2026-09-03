import { useState, useSyncExternalStore } from "react";

import { useEvent } from "../../../react/useEvent";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { ProjectionResource } from "../../application/resources/projectionResource";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ReviewCommentComposer } from "../../presentation/review/ReviewCommentComposer";
import type { ReviewAnchor } from "../../rendering/review/reviewModel";
import { useVoiceInputControl } from "../conversation/VoiceInputControl";

interface ReviewCommentEditorProps {
  anchor: ReviewAnchor;
  onCancel(): void;
  onSave(anchor: ReviewAnchor, body: string): void;
  owner: QualifiedThread;
}

/** Binds a local comment draft to the process-owned review voice scope. */
export function ReviewCommentEditor(props: ReviewCommentEditorProps): React.JSX.Element {
  const { anchor, onCancel, onSave, owner } = props;
  const runtime = useV2Runtime();
  const [body, setBody] = useState("");
  const [projectionOuter] = useState(() => runtime.projection(owner.savedServerId, owner.threadId));
  const opened = useSyncExternalStore(
    projectionOuter.subscribe,
    projectionOuter.snapshot,
    projectionOuter.snapshot,
  );
  const appendTranscript = useEvent((text: string) => {
    setBody((current) => (current.trim() === "" ? text : `${current.trimEnd()} ${text}`));
  });
  if (opened.value === null) {
    return (
      <ReviewCommentComposer
        anchor={anchor}
        body={body}
        onBodyChange={setBody}
        onCancel={onCancel}
        onSave={onSave}
      />
    );
  }
  return (
    <ReviewCommentComposerWithVoice
      anchor={anchor}
      body={body}
      onBodyChange={setBody}
      onCancel={onCancel}
      onSave={onSave}
      onTranscript={appendTranscript}
      owner={owner}
      resource={opened.value}
    />
  );
}

interface ReviewCommentComposerWithVoiceProps extends ReviewVoiceControlsProps {
  anchor: ReviewAnchor;
  body: string;
  onBodyChange(body: string): void;
  onCancel(): void;
  onSave(anchor: ReviewAnchor, body: string): void;
}

function ReviewCommentComposerWithVoice(
  props: ReviewCommentComposerWithVoiceProps,
): React.JSX.Element {
  const { anchor, body, onBodyChange, onCancel, onSave, onTranscript, owner, resource } = props;
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const voice = useVoiceInputControl({
    audience: owner.savedServerId,
    live: snapshot.value.state === "live" && snapshot.value.projections.live !== null,
    onTranscript,
    projection: snapshot.value.projections.live,
    scope: { id: owner.threadId, kind: "review" },
    thread: owner,
  });
  return (
    <ReviewCommentComposer
      anchor={anchor}
      body={body}
      onBodyChange={onBodyChange}
      onCancel={onCancel}
      onSave={onSave}
      voice={voice}
    />
  );
}

interface ReviewVoiceControlsProps {
  onTranscript(text: string): void;
  owner: QualifiedThread;
  resource: ProjectionResource;
}
