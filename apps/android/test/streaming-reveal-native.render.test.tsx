import { fireEvent, render } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";

import { useReducedMotionPreference } from "../src/rendering/reduced-motion-store";
import { useStreamingRevealKey } from "../src/rendering/streaming-reveal-context";
import { StreamingRevealSurface } from "../src/rendering/StreamingRevealSurface";

// Keep React reconciliation intact; only the Android drawing host needs a device.
jest.mock("react-native", () => {
  const native = jest.requireActual("react-native");
  return new Proxy(native, {
    get(target, key) {
      if (key === "Platform") return { ...target.Platform, OS: "android" };
      if (key === "UIManager") {
        return new Proxy(target.UIManager, {
          get(manager, name) {
            if (name === "getViewManagerConfig") {
              return (component: string) =>
                component === "CodeWideStreamingReveal"
                  ? {}
                  : manager.getViewManagerConfig(component);
            }
            return Reflect.get(manager, name);
          },
        });
      }
      if (key === "requireNativeComponent") return (name: string) => name;
      return Reflect.get(target, key);
    },
  });
});

jest.mock("../src/rendering/reduced-motion-store", () => ({
  useReducedMotionPreference: jest.fn(() => false),
}));

beforeEach(() => {
  jest.mocked(useReducedMotionPreference).mockReturnValue(false);
});

function RichContentRevealState() {
  const key = useStreamingRevealKey();
  return <Text>{key === null ? "Static rich content" : "Live rich content"}</Text>;
}

it.each([
  { animateNew: false, reduceMotion: false },
  { animateNew: true, reduceMotion: true },
])("keeps native text and actions mounted when animation stops: %s", (settings) => {
  const open = jest.fn();
  function content(animateNew: boolean) {
    return (
      <StreamingRevealSurface animateNew={animateNew} streamKey="answer">
        <RichContentRevealState />
        <Text selectable>Already visible answer</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Open link" onPress={open}>
          <Text>Link</Text>
        </Pressable>
      </StreamingRevealSurface>
    );
  }
  const view = render(content(true));
  const displayedText = view.getByText("Already visible answer");
  const link = view.getByRole("button", { name: "Open link" });
  expect(view.getByText("Live rich content")).toBeVisible();

  jest.mocked(useReducedMotionPreference).mockReturnValue(settings.reduceMotion);
  view.rerender(content(settings.animateNew));

  const host = view.UNSAFE_root.findByProps({
    reduceMotion: settings.reduceMotion,
    streamKey: "answer",
  });
  expect(host.props.animateNew).toBe(settings.animateNew);
  expect(view.getByText("Static rich content")).toBeVisible();
  expect(view.getByText("Already visible answer") === displayedText).toBe(true);
  expect(displayedText).toBeVisible();
  expect(displayedText.props.selectable).toBe(true);
  expect(view.getByRole("button", { name: "Open link" }) === link).toBe(true);
  fireEvent.press(link);
  expect(open).toHaveBeenCalledTimes(1);
});

it("enables new live updates without replacing recovered text", () => {
  const view = render(
    <StreamingRevealSurface animateNew={false} streamKey="recovered">
      <Text selectable>Recovered answer</Text>
    </StreamingRevealSurface>,
  );
  const displayedText = view.getByText("Recovered answer");

  view.rerender(
    <StreamingRevealSurface animateNew streamKey="recovered">
      <Text selectable>Recovered answer with a new suffix</Text>
    </StreamingRevealSurface>,
  );

  expect(view.getByText("Recovered answer with a new suffix") === displayedText).toBe(true);
  expect(displayedText).toBeVisible();
  const host = view.UNSAFE_root.findByProps({ reduceMotion: false, streamKey: "recovered" });
  expect(host.props.animateNew).toBe(true);
});
