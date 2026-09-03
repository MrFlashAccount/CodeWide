import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import { ExpoVideoPlayer } from "../src/v2/platform/rendering/ExpoVideoPlayer";

let mockVideoStatus = "loading";
let mockVideoError: Error | null = null;

jest.mock("expo", () => ({
  useEvent: () => ({ error: mockVideoError, status: mockVideoStatus }),
}));

jest.mock("expo-video", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    useVideoPlayer: () => ({ play: jest.fn(), status: mockVideoStatus }),
    VideoView: (props: object) => <View {...props} />,
  };
});

describe("V2 inline video player", () => {
  it.each([
    ["loading", "Video player · loading", true],
    ["readyToPlay", "Video player · ready", false],
    ["error", "Video player · error", false],
  ])("exposes the %s playback state to device automation", (status, label, busy) => {
    mockVideoStatus = status;
    mockVideoError = status === "error" ? new Error("Decoder failed") : null;

    render(
      <ExpoVideoPlayer
        autoplay={false}
        source={{ headers: { Authorization: "Bearer private" }, uri: "http://127.0.0.1/video" }}
        title="Recording"
      />,
    );

    const player = screen.getByLabelText(label);
    expect(player.props.accessibilityState).toEqual({ busy });
    if (status === "error") expect(screen.getByText("Decoder failed")).toBeTruthy();
  });
});
