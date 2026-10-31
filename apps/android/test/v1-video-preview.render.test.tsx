import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { UserMessageContent } from "../src/features/conversation/turns/UserMessageContent";
import { ContentReviewHost, useContentReviewRuntime } from "../src/rendering/ContentReviewHost";
import { DocumentPreviewHost } from "../src/rendering/DocumentPreviewHost";
import { ImagePreviewHost } from "../src/rendering/ImagePreviewHost";
import { RouteAttachmentVideoPreview } from "../src/rendering/AttachmentVideoPreview";
import { touchTarget } from "../src/theme";
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

it("renders MP4 as an image-sized paused preview in the message", async () => {
  const view = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 800, width: 400, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 24 },
      }}
    >
      <AppNoticeProvider>
        <AppFullscreenOverlayProvider>
          <ImagePreviewHost>
            <DocumentPreviewHost>
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
            </DocumentPreviewHost>
          </ImagePreviewHost>
        </AppFullscreenOverlayProvider>
      </AppNoticeProvider>
    </SafeAreaProvider>,
  );

  const preview = view.getByLabelText("Open comparison.mp4");
  expect(preview).toHaveStyle({ height: 180, width: 320 });
  expect(view.getByTestId("message-video-gallery")).toBeTruthy();
  await waitFor(() => {
    expect(view.getByTestId("mock-video-view").props.nativeControls).toBe(false);
  });
});

it("uses image-style fullscreen controls and starts a timestamped point review", async () => {
  const view = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 800, width: 400, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 24 },
      }}
    >
      <AppDialogProvider>
        <ContentReviewHost>
          <ReviewRuntime />
          <RouteAttachmentVideoPreview
            getAccess={access}
            name="comparison.mp4"
            onClose={() => undefined}
            path="/tmp/comparison.mp4"
          />
        </ContentReviewHost>
      </AppDialogProvider>
    </SafeAreaProvider>,
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
