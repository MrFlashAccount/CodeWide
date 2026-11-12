import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { RouteDocumentPreview } from "../src/features/attachments/RouteDocumentPreview";
import { UserMessageContent } from "../src/features/conversation/turns/UserMessageContent";
import { ContentReviewHost, useContentReviewRuntime } from "../src/rendering/ContentReviewHost";
import { DocumentPreviewHost } from "../src/rendering/DocumentPreviewHost";
import type { DocumentPreviewRequest } from "../src/rendering/DocumentPreviewHost";
import { ImagePreviewHost } from "../src/rendering/ImagePreviewHost";
import { RouteAttachmentVideoPreview } from "../src/rendering/AttachmentVideoPreview";
import { ThreadCodeDocumentContext } from "../src/rendering/ThreadCodeDocumentContext";
import { DownloadManagerProvider } from "../src/data/DownloadManagerProvider";
import type { DownloadManager } from "../src/data/downloadManager";
import { createTestDownloadManager } from "./downloads.fixture";
import { spacing, touchTarget } from "../src/theme";
import { ActionMenu } from "../src/ui/ActionMenu";
import { AppDialogProvider } from "../src/ui/AppDialog.tsx";
import { AppFullscreenOverlayProvider } from "../src/ui/AppFullscreenOverlay";
import { AppNoticeProvider } from "../src/ui/AppNotice";
import { radii } from "../src/theme";
import { urlTransport } from "../src/native/urlTransport";

jest.mock("expo", () => ({
  ...jest.requireActual("expo"),
  useEvent: (_target: unknown, _event: string, initial: unknown) => initial,
}));

jest.mock("expo-video", () => {
  const React = jest.requireActual("react");
  const { View } = jest.requireActual("react-native");
  return {
    VideoView: (props: Record<string, unknown>) =>
      React.createElement(View, { ...props, testID: "mock-video-view" }),
    useVideoPlayer: (_source: unknown, setup?: (player: Record<string, unknown>) => void) => {
      const player = {
        bufferedPosition: 0,
        currentLiveTimestamp: null,
        currentOffsetFromLive: null,
        currentTime: 7.25,
        duration: 25,
        keepScreenOnWhilePlaying: true,
        muted: false,
        pause: jest.fn(),
        play: jest.fn(),
        status: "readyToPlay",
        timeUpdateEventInterval: 0,
        videoTrack: null,
      };
      setup?.(player);
      return player;
    },
  };
});

jest.mock("../src/rendering/private-asset", () => ({
  ...jest.requireActual("../src/rendering/private-asset"),
  materializePrivateAsset: async () => ({ uri: "file:///comparison.mp4" }),
}));

const access = async () => ({
  authorization: "test",
  baseUrl: "https://example.test",
  transport: urlTransport,
});

function ReviewRuntime(): null {
  useContentReviewRuntime({
    attach: async () => "review-attachment",
    attachmentId: null,
    resources: null,
    thread: null,
    voiceController: null,
    voiceScope: "thread",
  });
  return null;
}

function RoutedMessageVideo(): React.JSX.Element {
  const [request, setRequest] = useState<DocumentPreviewRequest | null>(null);
  return (
    <ThreadCodeDocumentContext.Provider value={setRequest}>
      <UserMessageContent
        content={[
          {
            name: "comparison.mp4",
            path: "/tmp/comparison.mp4",
            type: "mention",
          },
        ]}
        getTransferAccess={access}
      />
      {request === null ? null : (
        <RouteDocumentPreview
          onClose={() => {
            setRequest(null);
          }}
          onOpenDocument={setRequest}
          request={request}
        />
      )}
    </ThreadCodeDocumentContext.Provider>
  );
}

it("renders MP4 as an image-sized paused preview in the message", async () => {
  const view = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 800, width: 400, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 24 },
      }}
    >
      <DownloadManagerProvider manager={createTestDownloadManager()}>
        <AppNoticeProvider>
          <AppFullscreenOverlayProvider>
            <ImagePreviewHost>
              <DocumentPreviewHost>
                <RoutedMessageVideo />
              </DocumentPreviewHost>
            </ImagePreviewHost>
          </AppFullscreenOverlayProvider>
        </AppNoticeProvider>
      </DownloadManagerProvider>
    </SafeAreaProvider>,
  );

  const preview = view.getByLabelText("Open comparison.mp4");
  expect(view.getByTestId("message-video-preview")).toHaveStyle({ height: 180, width: 320 });
  expect(view.getByTestId("message-video-gallery")).toBeTruthy();
  await waitFor(() => {
    expect(view.getByTestId("mock-video-view").props.nativeControls).toBe(false);
  });
  fireEvent.press(preview);
  await waitFor(() => {
    expect(view.getByLabelText("Close video")).toBeTruthy();
  });
});

function FullscreenProviders({
  children,
  downloads = createTestDownloadManager(),
}: {
  readonly children: React.ReactNode;
  readonly downloads?: DownloadManager;
}): React.JSX.Element {
  return (
    <DownloadManagerProvider manager={downloads}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { height: 800, width: 400, x: 0, y: 0 },
          insets: { bottom: 0, left: 0, right: 0, top: 24 },
        }}
      >
        <AppDialogProvider>
          <AppNoticeProvider>
            <AppFullscreenOverlayProvider>
              <ImagePreviewHost>
                <DocumentPreviewHost>
                  <ContentReviewHost>
                    <ReviewRuntime />
                    {children}
                  </ContentReviewHost>
                </DocumentPreviewHost>
              </ImagePreviewHost>
            </AppFullscreenOverlayProvider>
          </AppNoticeProvider>
        </AppDialogProvider>
      </SafeAreaProvider>
    </DownloadManagerProvider>
  );
}

it("uses image-style fullscreen controls and starts a timestamped point review", async () => {
  const view = render(
    <FullscreenProviders>
      <RouteAttachmentVideoPreview
        getAccess={access}
        name="comparison.mp4"
        onClose={() => undefined}
        path="/tmp/comparison.mp4"
      />
    </FullscreenProviders>,
  );

  await waitFor(() => {
    expect(view.getByLabelText("Close video")).toBeTruthy();
  });
  expect(view.getByLabelText("Close video")).toHaveStyle({
    borderRadius: radii.pill,
    height: touchTarget,
    width: touchTarget,
  });
  expect(view.queryByText("Close")).toBeNull();

  fireEvent(view.getByTestId("video-preview-viewport"), "layout", {
    nativeEvent: { layout: { height: 180, width: 320, x: 0, y: 0 } },
  });
  fireEvent.press(view.getByLabelText("Pin a comment on video"));
  fireEvent.press(view.getByLabelText("Place video review point"), {
    nativeEvent: { locationX: 80, locationY: 90 },
  });

  expect(view.getByPlaceholderText("What should change here?")).toBeTruthy();
  expect(view.getByText("Video · 25.0%, 50.0%")).toBeTruthy();
});

it("hides the video chrome on a tap without taking the touch from the player", async () => {
  const view = render(
    <FullscreenProviders>
      <RouteAttachmentVideoPreview
        getAccess={access}
        name="comparison.mp4"
        onClose={() => undefined}
        path="/tmp/comparison.mp4"
      />
    </FullscreenProviders>,
  );
  await waitFor(() => {
    expect(view.getByLabelText("Close video")).toBeTruthy();
  });
  const controls = () => view.getByTestId("video-preview-controls");
  expect(within(controls()).getByText("comparison.mp4")).toBeTruthy();
  // The title is as tall as the round buttons beside it.
  expect(view.getByTestId("media-preview-title")).toHaveStyle({
    borderRadius: radii.pill,
    height: touchTarget,
  });
  expect(controls()).toHaveStyle({ top: 24 + spacing.xs });
  const viewport = view.getByTestId("video-preview-viewport");
  const touch = (timestamp: number, pageX: number) => ({
    nativeEvent: { pageX, pageY: 100, timestamp, touches: [] },
  });

  fireEvent(viewport, "touchStart", touch(0, 100));
  fireEvent(viewport, "touchEnd", touch(120, 102));
  expect(controls().props.pointerEvents).toBe("none");
  // A drag (scrubbing the native seek bar) is not a tap.
  fireEvent(viewport, "touchStart", touch(200, 100));
  fireEvent(viewport, "touchEnd", touch(320, 220));
  expect(controls().props.pointerEvents).toBe("none");
  fireEvent(viewport, "touchStart", touch(400, 100));
  fireEvent(viewport, "touchEnd", touch(450, 100));
  expect(controls().props.pointerEvents).toBe("box-none");
});

it("downloads a host video from its actions menu", async () => {
  const directory = { name: "Downloads", native: {}, uri: "content://downloads" };
  const pickDirectory = jest.fn(async () => directory);
  const start = jest.fn(() => ({
    cancel: () => undefined,
    pause: () => undefined,
    promise: Promise.resolve({
      bytes: 1,
      mimeType: "video/mp4",
      sha256: "0".repeat(64),
      uri: "content://downloads/comparison.mp4",
    }),
  }));
  const view = render(
    <FullscreenProviders downloads={createTestDownloadManager({ pickDirectory, start })}>
      <RouteAttachmentVideoPreview
        getAccess={access}
        name="comparison.mp4"
        onClose={() => undefined}
        path="/tmp/comparison.mp4"
      />
    </FullscreenProviders>,
  );
  await waitFor(() => {
    expect(view.getByLabelText("Close video")).toBeTruthy();
  });
  const menus = view.UNSAFE_getAllByType(ActionMenu);
  expect(menus).toHaveLength(1);
  const menu = menus[0];
  expect(menu?.props.accessibilityLabel).toBe("Video actions");
  expect(menu?.props.actions.map((action: { label: string }) => action.label)).toEqual([
    "Download",
  ]);

  await act(async () => {
    menu?.props.onSelect("download");
  });

  await waitFor(() => {
    expect(start).toHaveBeenCalledWith({
      directory,
      getAccess: access,
      onProgress: expect.any(Function),
      source: { kind: "path", path: "/tmp/comparison.mp4" },
    });
  });
  expect(pickDirectory).toHaveBeenCalledTimes(1);
  expect(view.getByText("File saved")).toBeTruthy();
});

it("offers no download for a video without a direct download route", async () => {
  const view = render(
    <FullscreenProviders>
      <RouteAttachmentVideoPreview
        getAccess={access}
        name="comparison.mp4"
        onClose={() => undefined}
        path="comparison.mp4"
        source={{ id: "upload-1", kind: "content" }}
      />
    </FullscreenProviders>,
  );
  await waitFor(() => {
    expect(view.getByLabelText("Close video")).toBeTruthy();
  });
  expect(view.UNSAFE_queryAllByType(ActionMenu)).toHaveLength(0);
});
