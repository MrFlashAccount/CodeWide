import { router } from "expo-router";
import { useState, useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";
import type { V2Attachment } from "@codewide/sync-client/v2";

import { useEvent } from "../../../react/useEvent";
import { useV2Runtime } from "../../V2Application";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { colors } from "../../theme";
import { AttachmentPreviewContent } from "./AttachmentPreviewContent";
import { AttachmentPreviewHeader } from "./AttachmentPreviewHeader";
import { AttachmentPreviewState } from "./AttachmentPreviewState";
import type { AttachmentAnnotationCapability } from "./attachmentAnnotation";
import { attachmentGallery, type AttachmentGallery } from "./attachmentGallery";
import {
  attachmentPreviewMode,
  isHtmlAttachment,
  isImageAttachment,
} from "./attachmentPreviewModel";
import type { AttachmentRendererCapabilities } from "./previewCapabilities";
import { useDocumentViewerPreferences } from "./useDocumentViewerPreferences";

interface AttachmentPreviewScreenProps extends AttachmentRendererCapabilities {
  annotate?: AttachmentAnnotationCapability;
  attachments: readonly V2Attachment[];
  initialAttachmentId: string;
  owner: QualifiedThread;
}

interface LoadedAttachmentPreviewProps extends AttachmentRendererCapabilities {
  annotate?: AttachmentAnnotationCapability;
  attachment: V2Attachment;
  gallery: AttachmentGallery;
  owner: QualifiedThread;
  sourceUrl: string;
}

interface ActionFeedback {
  message: string;
  retry?: () => void | Promise<void>;
  tone: "error" | "success";
}

export function AttachmentPreviewScreen(props: AttachmentPreviewScreenProps): React.JSX.Element {
  const { annotate, attachments, initialAttachmentId, owner, Player, WebPreview } = props;
  const [selectedId, setSelectedId] = useState(initialAttachmentId);
  const images = attachments.filter(isImageAttachment);
  const attachment = attachments.find((value) => value.id === selectedId) ?? null;
  const imageIndex = images.findIndex((value) => value.id === selectedId);
  const gallery = attachmentGallery(images, imageIndex, setSelectedId);
  if (attachment === null) {
    return (
      <UnavailableAttachmentScreen
        mediaType=""
        message="This attachment is no longer available in the thread."
        name="Attachment unavailable"
      />
    );
  }
  if (attachment.downloadUrl === null) {
    return (
      <UnavailableAttachmentScreen
        mediaType={attachment.mediaType}
        message="The server did not provide a downloadable source for this attachment."
        name={attachment.name}
      />
    );
  }
  return (
    <LoadedAttachmentPreview
      key={`${attachment.id}\u0000${attachment.downloadUrl}`}
      attachment={attachment}
      gallery={gallery}
      owner={owner}
      Player={Player}
      sourceUrl={attachment.downloadUrl}
      WebPreview={WebPreview}
      {...(annotate === undefined ? {} : { annotate })}
    />
  );
}

function LoadedAttachmentPreview(props: LoadedAttachmentPreviewProps): React.JSX.Element {
  const { annotate, attachment, gallery, owner, Player, sourceUrl, WebPreview } = props;
  const runtime = useV2Runtime();
  const reader = useDocumentViewerPreferences();
  const readerPreferences = reader.snapshot().value;
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [resource] = useState(() =>
    runtime.preview(owner.savedServerId, sourceUrl, attachmentPreviewMode(attachment)),
  );
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const close = useEvent(() => router.back());
  const fail = useEvent((message: string, retry: () => void | Promise<void>): void => {
    const retryFailedAction = async (): Promise<void> => {
      setFeedback(null);
      try {
        await retry();
      } catch (cause) {
        setFeedback({
          message: attachmentActionFailureMessage(cause),
          retry: retryFailedAction,
          tone: "error",
        });
      }
    };
    setFeedback({ message, retry: retryFailedAction, tone: "error" });
  });
  const save = useEvent(async (): Promise<void> => {
    const file = await resource.save(attachment.name, attachment.mediaType);
    setFeedback({ message: `Saved ${file.name}`, tone: "success" });
  });
  const exportFile = useEvent(async (): Promise<void> => {
    await resource.exportFile(attachment.name, attachment.mediaType);
  });
  const annotateImage = useEvent(async (): Promise<void> => {
    if (annotate === undefined) return;
    const source = await resource.materialize(attachment.name, attachment.mediaType);
    await annotate({ attachmentId: attachment.id, name: attachment.name, source });
  });
  const changeTextScale = useEvent((delta: number): void => reader.changeTextScale(delta));
  const resetTextScale = useEvent((): void => reader.resetTextScale());
  const setLayoutMode = useEvent((mode: "reading" | "wide"): void => reader.setLayoutMode(mode));
  const readerActions = {
    onChangeTextScale: changeTextScale,
    onResetTextScale: resetTextScale,
    onSetLayoutMode: setLayoutMode,
    preferences: readerPreferences,
  };
  const showsReaderActions =
    snapshot.status !== "loading" &&
    snapshot.value.document !== null &&
    !isHtmlAttachment(attachment);
  return (
    <View style={styles.root}>
      <AttachmentPreviewHeader
        annotationEnabled={annotate !== undefined && isImageAttachment(attachment)}
        fileActionsEnabled
        mediaType={attachment.mediaType}
        name={attachment.name}
        onAnnotate={annotateImage}
        onClose={close}
        onExport={exportFile}
        onFailure={fail}
        onSave={save}
        {...(showsReaderActions ? { readerActions } : {})}
      />
      {feedback === null ? null : (
        <AttachmentPreviewState
          message={feedback.message}
          tone={feedback.tone}
          {...(feedback.retry === undefined ? {} : { onRetry: feedback.retry })}
        />
      )}
      <View style={styles.content}>
        {snapshot.status === "loading" ? (
          <AttachmentPreviewState message={`Opening ${attachment.name}…`} tone="loading" />
        ) : snapshot.status === "error" ? (
          <AttachmentPreviewState
            message={snapshot.message}
            onRetry={resource.refresh}
            tone="error"
          />
        ) : (
          <AttachmentPreviewContent
            attachment={attachment}
            document={snapshot.value.document}
            gallery={gallery}
            onClose={close}
            onRefresh={resource.refresh}
            onSubmitted={close}
            owner={owner}
            Player={Player}
            readerPreferences={readerPreferences}
            stream={snapshot.value.stream}
            WebPreview={WebPreview}
          />
        )}
      </View>
    </View>
  );
}

interface UnavailableAttachmentScreenProps {
  mediaType: string;
  message: string;
  name: string;
}

function UnavailableAttachmentScreen(props: UnavailableAttachmentScreenProps): React.JSX.Element {
  const { mediaType, message, name } = props;
  const close = useEvent(() => router.back());
  return (
    <View style={styles.root}>
      <AttachmentPreviewHeader
        annotationEnabled={false}
        fileActionsEnabled={false}
        mediaType={mediaType}
        name={name}
        onAnnotate={close}
        onClose={close}
        onExport={close}
        onFailure={ignoreAttachmentFailure}
        onSave={close}
      />
      <AttachmentPreviewState message={message} tone="error" />
    </View>
  );
}

function ignoreAttachmentFailure(): void {}

function attachmentActionFailureMessage(cause: unknown): string {
  return cause instanceof Error && cause.message !== ""
    ? cause.message
    : "Attachment action failed. Try again.";
}

const styles = StyleSheet.create({
  content: { flex: 1, minHeight: 0 },
  root: { backgroundColor: colors.background, flex: 1 },
});
