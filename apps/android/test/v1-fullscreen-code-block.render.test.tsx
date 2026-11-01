import { render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { ActivityContentViewer } from "../src/features/conversation/content/ActivityContentViewer";
import { NativeCodeBlockHost } from "../src/presentation/nativeCodeBlockHost";
import { FullscreenCodeBlock } from "../src/rendering/FullscreenCodeBlock";

const LONG_CODE = Array.from({ length: 80 }, (_, index) => `line ${String(index + 1)}`).join("\n");

function nativeCodeViewportStyle(view: ReturnType<typeof render>) {
  if (NativeCodeBlockHost === null) {
    throw new Error("The Android render suite must resolve the native code block host.");
  }
  const host = view.UNSAFE_getByType(NativeCodeBlockHost);
  return {
    code: host.props.code,
    style: StyleSheet.flatten(host.props.style),
  };
}

it("fills the fullscreen body with the complete code before any layout pass", () => {
  const view = render(<FullscreenCodeBlock language="text" onClose={() => {}} value={LONG_CODE} />);
  const viewport = nativeCodeViewportStyle(view);
  expect(viewport.code).toBe(LONG_CODE);
  // Layout, not a measured or content-estimated height, sizes the viewport, so
  // the body is filled after every window resize and longer rows scroll natively.
  expect(viewport.style.height).toBeUndefined();
  expect(viewport.style.flexGrow).toBe(1);
  expect(viewport.style.minHeight).toBe(0);
});

it("fills the full output body with wrapped terminal text before any layout pass", () => {
  const view = render(
    <ActivityContentViewer
      onClose={() => {}}
      presentation="terminal"
      text={LONG_CODE}
      title="Command output"
    />,
  );
  const viewport = nativeCodeViewportStyle(view);
  expect(viewport.code).toBe(LONG_CODE);
  expect(viewport.style.height).toBeUndefined();
  expect(viewport.style.flexGrow).toBe(1);
});
