import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { V2Attachment } from "@codewide/sync-client/v2";
import { savedServerId, threadId } from "../src/v2/domain/ids";

import { AttachmentPreviewContent } from "../src/v2/features/attachments/AttachmentPreviewContent";
import { AttachmentPreviewHeader } from "../src/v2/features/attachments/AttachmentPreviewHeader";
import { AttachmentDocumentPreview } from "../src/v2/features/attachments/AttachmentDocumentPreview";
import { DocumentViewerPreferenceResource } from "../src/v2/features/attachments/documentViewerPreferenceResource";
import { AttachmentMarkdownReview } from "../src/v2/features/attachments/AttachmentMarkdownReview";
import { AttachmentList } from "../src/v2/features/attachments/AttachmentList";
import { ImageGalleryPreview } from "../src/v2/features/attachments/ImageGalleryPreview";
import { V2RuntimeProvider } from "../src/v2/application/react/V2RuntimeContext";
import { ObservableResource } from "../src/v2/application/resources/resource";
import type { V2Runtime } from "../src/v2/application/v2Runtime";
import { ActionRunner } from "../src/v2/ui/actions/ActionRunner";
import type {
  VideoPlayerCapabilityProps,
  WebPreviewCapabilityProps,
} from "../src/v2/features/attachments/previewCapabilities";

describe("V2 attachment preview", () => {
  it("owns pending state and suppresses duplicate save activation", async () => {
    const pending = deferred<void>();
    const save = jest.fn(() => pending.promise);
    render(
      <AttachmentPreviewHeader
        annotationEnabled={false}
        fileActionsEnabled
        mediaType="text/plain"
        name="notes.txt"
        onAnnotate={() => undefined}
        onClose={() => undefined}
        onExport={() => undefined}
        onFailure={() => undefined}
        onSave={save}
      />,
    );

    const button = screen.getByLabelText("Save attachment");
    fireEvent.press(button);
    fireEvent.press(button);

    expect(save).toHaveBeenCalledTimes(1);
    expect(button.props.accessibilityState).toEqual({ busy: true, disabled: true });

    await act(async () => pending.resolve());
    expect(screen.getByLabelText("Save attachment").props.accessibilityState).toEqual({
      busy: false,
      disabled: false,
    });
  });

  it("surfaces an action error with its exact retry operation", async () => {
    const save = jest.fn(async () => Promise.reject(new Error("Disk permission was denied")));
    const fail = jest.fn();
    render(
      <AttachmentPreviewHeader
        annotationEnabled={false}
        fileActionsEnabled
        mediaType="text/plain"
        name="notes.txt"
        onAnnotate={() => undefined}
        onClose={() => undefined}
        onExport={() => undefined}
        onFailure={fail}
        onSave={save}
      />,
    );

    await act(async () => fireEvent.press(screen.getByLabelText("Save attachment")));

    expect(fail).toHaveBeenCalledWith("Disk permission was denied", save);
  });

  it("exposes the complete document reader controls and applies reader layout", async () => {
    const changeScale = jest.fn();
    const resetScale = jest.fn();
    const setLayout = jest.fn();
    const download = jest.fn(async () => undefined);
    render(
      <AttachmentPreviewHeader
        annotationEnabled={false}
        fileActionsEnabled
        mediaType="text/plain"
        name="notes.txt"
        onAnnotate={() => undefined}
        onClose={() => undefined}
        onExport={() => undefined}
        onFailure={() => undefined}
        onSave={download}
        readerActions={{
          onChangeTextScale: changeScale,
          onResetTextScale: resetScale,
          onSetLayoutMode: setLayout,
          preferences: { layoutMode: "reading", textScale: 1.2 },
        }}
      />,
    );

    fireEvent.press(screen.getByLabelText("Document reader actions"));
    expect(screen.getByText("Download")).toBeTruthy();
    expect(screen.getByText("Smaller")).toBeTruthy();
    expect(screen.getByText("Reset to 100% (120%)")).toBeTruthy();
    expect(screen.getByText("Larger")).toBeTruthy();
    expect(screen.getByText("Reading width")).toBeTruthy();
    expect(screen.getByText("Full width")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Document reader actions: Larger"));
    expect(changeScale).toHaveBeenCalledWith(0.1);

    fireEvent.press(screen.getByLabelText("Document reader actions"));
    fireEvent.press(screen.getByLabelText("Document reader actions: Full width"));
    expect(setLayout).toHaveBeenCalledWith("wide");

    fireEvent.press(screen.getByLabelText("Document reader actions"));
    await act(async () =>
      fireEvent.press(screen.getByLabelText("Document reader actions: Download")),
    );
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("persists reader preferences without letting a late load overwrite a user change", async () => {
    const loaded = deferred<{ layoutMode: "wide"; textScale: number } | null>();
    const save = jest.fn(async () => undefined);
    const resource = new DocumentViewerPreferenceResource({ load: () => loaded.promise, save });
    const unsubscribe = resource.subscribe(() => undefined);

    resource.changeTextScale(0.2);
    loaded.resolve({ layoutMode: "wide", textScale: 0.8 });
    await act(async () => loaded.promise);

    expect(resource.snapshot().value).toEqual({ layoutMode: "wide", textScale: 1.2 });
    await waitFor(() => expect(save).toHaveBeenCalledWith({ layoutMode: "wide", textScale: 1.2 }));
    unsubscribe();
  });

  it("scales plain document text through the V2 reader context", () => {
    render(
      <AttachmentDocumentPreview
        attachment={attachment("notes.txt", "text/plain")}
        document={{ bodyBase64: "bm90ZXM=", contentType: "text/plain" }}
        onSubmitted={jest.fn()}
        owner={owner}
        readerPreferences={{ layoutMode: "reading", textScale: 1.2 }}
        WebPreview={FakeWebPreview}
      />,
    );

    expect(screen.getByText("notes").props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ fontSize: 15.6, lineHeight: 24 })]),
    );
  });

  it("navigates an image gallery and retries an image decoding failure", async () => {
    const next = jest.fn();
    const previous = jest.fn();
    const retry = jest.fn(async () => undefined);
    render(
      <ImageGalleryPreview
        canGoNext
        canGoPrevious
        count={3}
        index={1}
        name="photo.png"
        onClose={() => undefined}
        onNext={next}
        onPrevious={previous}
        onRetry={retry}
        source={{ headers: { Authorization: "Bearer private" }, uri: "http://127.0.0.1/p" }}
      />,
    );

    expect(screen.getByLabelText("Loading image")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Previous image"));
    fireEvent.press(screen.getByLabelText("Next image"));
    fireEvent(screen.getByLabelText("photo.png"), "error");
    expect(screen.getByText("Could not load this image.")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByLabelText("Retry image preview")));

    expect(previous).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("dispatches HTML, text, video, and generic files to the correct preview surfaces", () => {
    const gallery = {
      canGoNext: false,
      canGoPrevious: false,
      count: 1,
      index: 0,
      onNext: jest.fn(),
      onPrevious: jest.fn(),
    };
    const view = render(
      <AttachmentPreviewContent
        attachment={attachment("report.html", "text/html")}
        document={{ bodyBase64: "PGgxPlJlcG9ydDwvaDE+", contentType: "text/html" }}
        gallery={gallery}
        onClose={() => undefined}
        onRefresh={jest.fn()}
        onSubmitted={jest.fn()}
        owner={owner}
        Player={FakeVideoPlayer}
        stream={null}
        WebPreview={FakeWebPreview}
      />,
    );
    expect(screen.getByText("<h1>Report</h1>")).toBeTruthy();

    view.rerender(
      <AttachmentPreviewContent
        attachment={attachment("notes.txt", "text/plain")}
        document={{ bodyBase64: "bm90ZXM=", contentType: "text/plain" }}
        gallery={gallery}
        onClose={() => undefined}
        onRefresh={jest.fn()}
        onSubmitted={jest.fn()}
        owner={owner}
        Player={FakeVideoPlayer}
        stream={null}
        WebPreview={FakeWebPreview}
      />,
    );
    expect(screen.getByText("notes")).toBeTruthy();

    view.rerender(
      <AttachmentPreviewContent
        attachment={attachment("recording.mp4", "video/mp4")}
        document={null}
        gallery={gallery}
        onClose={() => undefined}
        onRefresh={jest.fn()}
        onSubmitted={jest.fn()}
        owner={owner}
        Player={FakeVideoPlayer}
        stream={{ headers: { Authorization: "Bearer private" }, uri: "http://127.0.0.1/video" }}
        WebPreview={FakeWebPreview}
      />,
    );
    expect(screen.getByText("Video: recording.mp4")).toBeTruthy();

    view.rerender(
      <AttachmentPreviewContent
        attachment={attachment("report.pdf", "application/pdf")}
        document={null}
        gallery={gallery}
        onClose={() => undefined}
        onRefresh={jest.fn()}
        onSubmitted={jest.fn()}
        owner={owner}
        Player={FakeVideoPlayer}
        stream={{ headers: null, uri: "http://127.0.0.1/report" }}
        WebPreview={FakeWebPreview}
      />,
    );
    expect(screen.getByText("Use Save or Open to view this file in another app.")).toBeTruthy();
  });

  it("adds and sends a whole-document Markdown review through the ordinary V2 workflow", async () => {
    const attachText = jest.fn(async () => "local-review");
    const commit = jest.fn();
    const executeCorrelated = jest.fn(async () => completedReviewSettlement());
    const onSubmitted = jest.fn();
    const runtime = reviewRuntime({ attachText, commit, executeCorrelated });
    render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { height: 800, width: 400, x: 0, y: 0 },
          insets: { bottom: 0, left: 0, right: 0, top: 0 },
        }}
      >
        <V2RuntimeProvider runtime={runtime}>
          <ActionRunner>
            <AttachmentMarkdownReview
              attachment={attachment("report.md", "text/markdown")}
              onSubmitted={onSubmitted}
              owner={owner}
              source="# Report\n\nReview me."
              truncated={false}
            />
          </ActionRunner>
        </V2RuntimeProvider>
      </SafeAreaProvider>,
    );

    await act(async () => fireEvent.press(screen.getByLabelText("Comment on entire document")));
    fireEvent.changeText(screen.getByLabelText("Review comment"), "Clarify this section.");
    await act(async () => fireEvent.press(screen.getByLabelText("Save review comment")));
    await screen.findByText("Clarify this section.");
    await act(async () => fireEvent.press(screen.getByLabelText("Send review")));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1));
    expect(attachText).toHaveBeenCalledWith(
      "codewide-review-feedback.md",
      "text/markdown",
      expect.stringContaining("Clarify this section."),
    );
    expect(attachText.mock.calls[0]?.[2]).toContain("report.md");
    expect(executeCorrelated).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("renders the reachable V2 empty attachment state without inventing a resource row", () => {
    render(
      <AttachmentList
        attachments={[]}
        onClose={jest.fn()}
        onRefresh={jest.fn(async () => undefined)}
        owner={owner}
      />,
    );

    expect(screen.getByLabelText("No attachments")).toBeTruthy();
    expect(screen.getByText("No attachments in this thread.")).toBeTruthy();
    expect(screen.queryByLabelText(/^Open attachment /u)).toBeNull();
  });
});

const owner = {
  savedServerId: savedServerId("saved-server-a"),
  threadId: threadId("thread-a"),
};

function FakeVideoPlayer(props: VideoPlayerCapabilityProps): React.JSX.Element {
  return <Text>{`Video: ${props.title}`}</Text>;
}

function FakeWebPreview(props: WebPreviewCapabilityProps): React.JSX.Element {
  return <Text>{props.html}</Text>;
}

function attachment(name: string, mediaType: string): V2Attachment {
  return {
    downloadUrl: `/v2/files/preview?path=${name}`,
    id: name,
    mediaType,
    name,
    sizeBytes: "10",
  };
}

interface ReviewRuntimeInput {
  attachText(name: string, mediaType: string, value: string): Promise<string>;
  commit(): void;
  executeCorrelated(): Promise<ReturnType<typeof completedReviewSettlement>>;
}

function reviewRuntime(input: ReviewRuntimeInput): V2Runtime {
  const projection = new ObservableResource({
    operations: [],
    projections: { live: null, retained: null },
    state: "offline" as const,
    version: 0,
  });
  const outer = new ObservableResource<unknown>(projection);
  return {
    commands: { executeCorrelated: input.executeCorrelated },
    composerAttachments: {
      draft: () => ({
        attachText: input.attachText,
        commit: input.commit,
        prepareInput: async () => [{ attachmentId: "attachment-a", kind: "attachment" as const }],
      }),
    },
    projection: () => outer,
    voice: idleVoiceController(),
  } as unknown as V2Runtime;
}

function idleVoiceController(): object {
  const snapshot = { message: null, state: "idle" as const };
  return {
    activeLevel: () => 0,
    activeSnapshot: () => snapshot,
    bind: () => () => undefined,
    level: () => 0,
    snapshot: () => snapshot,
    subscribe: () => () => undefined,
    subscribeActive: () => () => undefined,
    subscribeActiveLevel: () => () => undefined,
    subscribeLevel: () => () => undefined,
  };
}

function completedReviewSettlement() {
  return {
    correlationId: "review-correlation",
    frame: {
      operationId: "review-operation",
      result: { kind: "turn.submit" as const, threadId: "thread-a", turnId: "turn-b" },
      type: "commandCompleted" as const,
    },
    kind: "terminal" as const,
    operationId: "review-operation",
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
}

function deferred<T>(): Deferred<T> {
  let resolve = (_value: T | PromiseLike<T>): void => undefined;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
