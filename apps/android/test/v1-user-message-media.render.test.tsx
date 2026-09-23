import { render, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { UserMessageContent } from "../src/features/conversation/turns/UserMessageContent";
import { ImagePreviewHost } from "../src/rendering/ImagePreviewHost";
import { DocumentPreviewHost } from "../src/rendering/DocumentPreviewHost";
import { AppFullscreenOverlayProvider } from "../src/ui/AppFullscreenOverlay";
import { AppNoticeProvider } from "../src/ui/AppNotice";

// Native private-file downloads are outside this layout test; retain the real
// image resource lifecycle and supply the resulting local preview URI.
jest.mock("../src/rendering/private-asset", () => ({
  ...jest.requireActual("../src/rendering/private-asset"),
  materializePrivateAsset: async () => ({ uri: "file:///preview.png" }),
}));

it("keeps file cards at the left while centering the image inside its cover preview", async () => {
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
                  { type: "image", url: "data:image/png;base64,iVBORw0KGgo=" },
                  { type: "mention", name: "plan.md", path: "/tmp/plan.md" },
                  { type: "text", text: "Проверь картинку и план.", text_elements: [] },
                ]}
              />
            </DocumentPreviewHost>
          </ImagePreviewHost>
        </AppFullscreenOverlayProvider>
      </AppNoticeProvider>
    </SafeAreaProvider>,
  );

  expect(view.getByText("Проверь картинку и план.")).toBeTruthy();
  expect(view.getByLabelText("Open plan.md")).toBeTruthy();
  expect(view.getByTestId("message-attachment-grid")).toHaveStyle({ alignSelf: "flex-start" });
  await waitFor(() => {
    expect(view.getByLabelText("Open Image 1")).toHaveStyle({
      alignItems: "center",
      justifyContent: "center",
      width: "100%",
      height: "100%",
    });
  });
  expect(view.getByLabelText("Image 1").props.resizeMode).toBe("cover");
});

it("shows an attached SVG in the image gallery", async () => {
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
                content={[{ type: "mention", name: "drawing.svg", path: "/tmp/drawing.svg" }]}
                getTransferAccess={async () => ({ authorization: "test", baseUrl: "https://example.test" })}
              />
            </DocumentPreviewHost>
          </ImagePreviewHost>
        </AppFullscreenOverlayProvider>
      </AppNoticeProvider>
    </SafeAreaProvider>,
  );

  await waitFor(() => {
    expect(view.getByTestId("user-image-gallery")).toBeTruthy();
    expect(view.getByLabelText("Open Image drawing.svg")).toBeTruthy();
  });
});
