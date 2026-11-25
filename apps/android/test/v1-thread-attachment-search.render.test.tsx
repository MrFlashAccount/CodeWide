import { act, fireEvent, render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { DownloadManagerProvider } from "../src/data/DownloadManagerProvider";
import { createTestDownloadManager } from "./downloads.fixture";
import { ImagePreviewHost } from "../src/rendering/ImagePreviewHost";
import { DocumentPreviewHost } from "../src/rendering/DocumentPreviewHost";
import { AppFullscreenOverlayProvider } from "../src/ui/AppFullscreenOverlay";
import { AppNoticeProvider } from "../src/ui/AppNotice";
import type { ReactNode } from "react";
import { createThreadResourcesModel } from "../src/data/thread-resources-model";
import type { ThreadAttachmentResource } from "../src/data/thread-resource-types";
import { ThreadAttachmentsRoute } from "../src/features/attachments/ThreadAttachmentsRoute";

// The Compose sheet window is native. Keep the sheet contents, row actions and resource owner real.
jest.mock("@expo/ui/jetpack-compose", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const Host = ({ children }: { readonly children?: ReactNode }) => <View>{children}</View>;
  return { Host, ModalBottomSheet: Host, RNHostView: Host };
});

function attachment(name: string, path: string | null): ThreadAttachmentResource {
  return {
    itemId: name,
    key: name,
    kind: "file",
    name,
    origin: "user",
    path,
    turnId: "turn",
    url: path === null ? "https://example.org/note" : null,
  };
}

it("filters the chat's attachments by name or path, opens a match and clears the search", () => {
  const model = createThreadResourcesModel();
  const openDocument = jest.fn();
  const update = (attachments: ThreadAttachmentResource[]) =>
    model.put({
      connectionId: "server",
      error: null,
      id: "files",
      status: "ready",
      threadId: "thread",
      updatedAt: 1,
      value: {
        attachments,
        changes: [],
        changeScope: "session",
        changeScopes: ["session"],
        revision: "1",
        threadId: "thread",
      },
    });
  const notes = attachment("Notes.md", null);
  const report = attachment("Report.pdf", "/workspace/invoices/Report.pdf");
  update([notes, report]);
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
                <ThreadAttachmentsRoute
                  cwd="/workspace"
                  getTransferAccess={jest.fn()}
                  model={model}
                  onClose={jest.fn()}
                  onOpenBrowser={jest.fn()}
                  onOpenCodeDocument={jest.fn()}
                  onOpenDocument={openDocument}
                  resourceId="files"
                  revision="1"
                  visible
                />
              </DocumentPreviewHost>
            </ImagePreviewHost>
          </AppFullscreenOverlayProvider>
        </AppNoticeProvider>
      </DownloadManagerProvider>
    </SafeAreaProvider>,
  );
  const field = view.getByLabelText("Search attachments");
  fireEvent.changeText(field, " INVOICES ");
  expect(view.getByText(report.name)).toBeVisible();
  expect(view.queryByText(notes.name)).toBeNull();
  fireEvent.changeText(field, "NOTES.MD");
  fireEvent.press(view.getByLabelText("Open attachment Notes.md"));
  expect(openDocument).toHaveBeenCalledWith(
    expect.objectContaining({ name: notes.name, source: { kind: "remote", url: notes.url } }),
  );

  fireEvent.changeText(field, ".png");
  expect(view.getByText("No matching attachments.")).toBeVisible();
  const image = attachment("chart.png", "/workspace/chart.png");
  act(() => update([notes, report, image]));
  expect(view.getByText(image.name)).toBeVisible();
  expect(view.queryByText("No matching attachments.")).toBeNull();

  fireEvent.press(view.getByRole("button", { name: "Clear attachment search" }));
  expect(view.getByDisplayValue("")).toBeVisible();
  expect(view.getByText(notes.name)).toBeVisible();
  expect(view.getByText(report.name)).toBeVisible();
  act(() => update([]));
  expect(view.getByText("No attachments in this thread.")).toBeVisible();
});
