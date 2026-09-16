import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { useState, type ReactNode } from "react";
import { Pressable, Text } from "react-native";
import { State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { ContentReviewHost, useContentReviewRuntime } from "../src/rendering/ContentReviewHost";
import { ImagePreviewHost, useImagePreview, useImagePreviewAnnotationHandler } from "../src/rendering/ImagePreviewHost";
import { AppFullscreenOverlayProvider, type AppFullscreenOverlayController } from "../src/ui/AppFullscreenOverlay";
// Use the real permission-dialog context, not the legacy callable dialog mock.
import { AppDialogProvider } from "../src/ui/AppDialog.tsx";

// WHY: Insets are provided by a native view, unavailable in the Node renderer.
jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);
// WHY: The native portal host is unused by the in-process fullscreen adapter.

const annotate = jest.fn(async () => undefined);
const attach = jest.fn(async (_markdown: string) => "review-attachment");
const image = { id: "photo", label: "Photo", source: { uri: "file:///photo.png" }, reference: "scoped:attachments:photo.png", draft: { scope: "thread", attachmentId: "photo" } };

function Preview() {
  const [overlay, setOverlay] = useState<ReactNode>(null);
  const open = useImagePreview();
  useImagePreviewAnnotationHandler(annotate);
  useContentReviewRuntime({ attach, attachmentId: null, thread: null, voiceScope: "thread", resources: null, voiceController: null });
  const close = () => setOverlay(null);
  const fullscreen: AppFullscreenOverlayController = {
    present: (content) => { setOverlay(content({ close })); return { id: "preview", close }; },
    dismissAll: close, dismissScope: close,
  };
  return <><Pressable onPress={() => open(image, fullscreen)}><Text>Open photo</Text></Pressable>{overlay}</>;
}

it("offers both drawing and pins, saves the image comment and restores its point on reopen", async () => {
  const view = render(<AppDialogProvider><AppFullscreenOverlayProvider><ContentReviewHost><ImagePreviewHost><Preview /></ImagePreviewHost></ContentReviewHost></AppFullscreenOverlayProvider></AppDialogProvider>);
  fireEvent.press(view.getByText("Open photo"));
  expect(view.getByLabelText("Photo full screen").props.resizeMethod).toBe("resize");
  fireEvent.press(view.getByLabelText("Annotate image in QuickDraw"));
  await waitFor(() => expect(annotate).toHaveBeenCalledWith(image, expect.any(Function)));
  fireEvent(view.getByTestId("image-preview-viewport"), "layout", { nativeEvent: { layout: { width: 300, height: 300 } } });
  fireEvent(view.getByLabelText("Photo full screen"), "load", { nativeEvent: { source: { width: 200, height: 100 } } });
  fireEvent.press(view.getByLabelText("Pin a comment on image"));
  await waitFor(() => expect(getByGestureTestId("image-review-pin-tap").config.enabled).toBe(true));
  act(() => fireGestureHandler(getByGestureTestId("image-review-pin-tap"), [{ state: State.END, x: 150, y: 150 }]));
  fireEvent.changeText(view.getByPlaceholderText("What should change here?"), "Change the center");
  fireEvent.press(view.getByLabelText("Save review comment"));
  await waitFor(() => expect(attach).toHaveBeenCalledWith(expect.stringContaining("Change the center")));
  expect(attach).toHaveBeenCalledWith(expect.stringContaining("(50.0%, 50.0%)"));
  fireEvent.press(view.getByLabelText("Close image"));
  fireEvent.press(view.getByText("Open photo"));
  expect(view.getByText("1")).toBeTruthy();
  expect(view.queryByPlaceholderText("What should change here?")).toBeNull();
});
