import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

import { RouteImageDocumentPreview } from "../src/features/attachments/RouteImageDocumentPreview";
import { ContentReviewHost } from "../src/rendering/ContentReviewHost";
import {
  ImagePreviewHost,
  useImagePreviewAnnotationHandler,
} from "../src/rendering/ImagePreviewHost";
import { materializePrivateAsset } from "../src/rendering/private-asset";
import { AppDialogProvider } from "../src/ui/AppDialog.tsx";
import { OverlaySurfaceProvider } from "../src/ui/OverlaySurfaceContext";
import { spacing } from "../src/theme";

// WHY: The test controls transfer completion while keeping the resource and preview owners real.
jest.mock("../src/rendering/private-asset", () => ({ materializePrivateAsset: jest.fn() }));
// WHY: Download permissions are independent of the image preview lifecycle under test.
jest.mock("../src/rendering/DocumentPreviewHost", () => ({
  useDocumentDownload: () => jest.fn(async () => undefined),
}));
// WHY: Native safe-area measurement is unavailable in the Node renderer.
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

function pendingImage() {
  let resolve: (value: { headers: Record<string, string>; uri: string }) => void = () => undefined;
  const promise = new Promise<{ headers: Record<string, string>; uri: string }>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const annotate = jest.fn(async () => undefined);

function AnnotationCapability() {
  useImagePreviewAnnotationHandler(annotate);
  return null;
}

function preview(onClose = jest.fn()) {
  return render(
    <SafeAreaInsetsContext.Provider value={{ top: 32, bottom: 24, left: 0, right: 0 }}>
      <OverlaySurfaceProvider surface="fullscreen-modal">
        <AppDialogProvider>
          <ContentReviewHost>
            <ImagePreviewHost>
              <AnnotationCapability />
              <RouteImageDocumentPreview
                onClose={onClose}
                request={{
                  getTransferAccess: async () => {
                    throw new Error("Transfer is mocked");
                  },
                  kind: "image",
                  name: "Diagram",
                  path: "/tmp/diagram.png",
                }}
              />
            </ImagePreviewHost>
          </ContentReviewHost>
        </AppDialogProvider>
      </OverlaySurfaceProvider>
    </SafeAreaInsetsContext.Provider>,
  );
}

beforeEach(() => {
  jest.mocked(materializePrivateAsset).mockReset();
  annotate.mockClear();
});

it("centers the pending surface and permits dismissal before the thumbnail arrives", () => {
  jest.mocked(materializePrivateAsset).mockReturnValue(pendingImage().promise);
  const close = jest.fn();
  const view = preview(close);
  expect(view.getByTestId("route-image-status")).toHaveStyle({
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000000",
  });
  expect(view.getByLabelText("Loading image preview")).toBeTruthy();
  expect(view.queryByText("Loading image…")).toBeNull();
  fireEvent.press(view.getByLabelText("Close image"));
  expect(close).toHaveBeenCalledTimes(1);
});

it("shows the thumbnail before detail and keeps it until the detail frame decodes", async () => {
  const thumbnail = pendingImage();
  const detail = pendingImage();
  jest
    .mocked(materializePrivateAsset)
    .mockImplementation((_source, options) =>
      options.variant === "preview" ? thumbnail.promise : detail.promise,
    );
  const view = preview();
  await act(async () => thumbnail.resolve({ headers: {}, uri: "file:///preview.webp" }));
  // A local Android image must never decode against the pre-layout 1px placeholder.
  expect(view.queryByLabelText("Diagram full screen")).toBeNull();
  const viewport = await view.findByTestId("image-preview-viewport");
  fireEvent(viewport, "layout", { nativeEvent: { layout: { width: 300, height: 0 } } });
  expect(view.queryByLabelText("Diagram full screen")).toBeNull();
  fireEvent(viewport, "layout", { nativeEvent: { layout: { width: 300, height: 600 } } });
  const image = await view.findByLabelText("Diagram full screen");
  expect(view.getByTestId("image-preview-frame")).toHaveStyle({ width: 300, height: 600 });
  // These server derivatives are bounded; native decode must preserve their pixels for zoom/rotation.
  expect(image.props.resizeMethod).toBe("scale");
  fireEvent(image, "load", { nativeEvent: { source: { height: 200, width: 300 } } });
  expect(image.props.source.uri).toBe("file:///preview.webp");
  expect(view.queryByTestId("route-image-status")).toBeNull();
  expect(view.getByTestId("image-preview-surface")).toHaveStyle({
    paddingTop: 0,
    paddingBottom: 0,
  });
  expect(view.getByTestId("image-preview-controls")).toHaveStyle({ top: spacing.xs });
  fireEvent.press(view.getByLabelText("Annotate image in QuickDraw"));
  expect(annotate).not.toHaveBeenCalled();
  await act(async () => detail.resolve({ headers: {}, uri: "file:///detail.webp" }));
  await waitFor(() =>
    expect(annotate).toHaveBeenCalledWith(
      expect.objectContaining({ source: { headers: {}, uri: "file:///detail.webp" } }),
      expect.any(Function),
    ),
  );
  const highQuality = await view.findByLabelText("Diagram high quality");
  expect(highQuality.props.resizeMethod).toBe("scale");
  expect(view.getByLabelText("Diagram full screen")).toBeTruthy();
  fireEvent(highQuality, "load", { nativeEvent: { source: { height: 800, width: 1200 } } });
  expect(view.queryByLabelText("Diagram full screen")).toBeNull();
  fireEvent(viewport, "layout", { nativeEvent: { layout: { width: 600, height: 300 } } });
  expect(view.getByTestId("image-preview-frame")).toHaveStyle({ width: 450, height: 300 });
  expect(view.getByLabelText("Diagram high quality").props.source.uri).toBe("file:///detail.webp");
});

it("retains the thumbnail when detail download fails", async () => {
  jest.mocked(materializePrivateAsset).mockImplementation(async (_source, options) => {
    if (options.variant === "detail") throw new Error("Detail unavailable");
    return { headers: {}, uri: "file:///fallback-preview.webp" };
  });
  const view = preview();
  fireEvent(await view.findByTestId("image-preview-viewport"), "layout", {
    nativeEvent: { layout: { width: 300, height: 600 } },
  });
  const image = await view.findByLabelText("Diagram full screen");
  fireEvent(image, "load", { nativeEvent: { source: { height: 200, width: 300 } } });
  await waitFor(() =>
    expect(materializePrivateAsset).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ variant: "detail" }),
    ),
  );
  expect(view.getByLabelText("Diagram full screen").props.source.uri).toBe(
    "file:///fallback-preview.webp",
  );
  expect(view.queryByTestId("route-image-status")).toBeNull();
});

it("offers readable recovery and retries the thumbnail request", async () => {
  jest.mocked(materializePrivateAsset).mockRejectedValueOnce(new Error("Image unavailable"));
  jest
    .mocked(materializePrivateAsset)
    .mockResolvedValue({ headers: {}, uri: "file:///retry.webp" });
  const view = preview();
  expect(await view.findByText("Image unavailable")).toHaveStyle({ color: "#ffffff" });
  fireEvent.press(view.getByText("Retry"));
  fireEvent(await view.findByTestId("image-preview-viewport"), "layout", {
    nativeEvent: { layout: { width: 300, height: 600 } },
  });
  expect(await view.findByLabelText("Diagram full screen")).toBeTruthy();
  expect(view.queryByText("Image unavailable")).toBeNull();
});
