import { render, waitFor } from "@testing-library/react-native";

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
    </AppNoticeProvider>,
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
