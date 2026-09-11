import { fireEvent, render } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";

import { StreamingRevealSurface } from "../src/rendering/StreamingRevealSurface";

it("keeps content and actions usable when the APK has no reveal adapter", () => {
  const open = jest.fn();
  const result = render(
    <StreamingRevealSurface streamKey="answer">
      <Text selectable>Hello</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Open link" onPress={open}>
        <Text>Link</Text>
      </Pressable>
    </StreamingRevealSurface>,
  );
  expect(result.getByTestId("streaming-reveal-fallback")).toBeVisible();
  expect(result.getByText("Hello").props.selectable).toBe(true);
  fireEvent.press(result.getByRole("button"));
  expect(open).toHaveBeenCalledTimes(1);
  result.rerender(
    <StreamingRevealSurface streamKey="answer">
      <Text selectable>Hello world</Text>
    </StreamingRevealSurface>,
  );
  expect(result.getByText("Hello world")).toBeVisible();
});
