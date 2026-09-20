import { render } from "@testing-library/react-native";

import { attachmentPresentationTarget } from "../src/features/attachments/threadAttachmentRouteActions";
import { documentPreviewSurface } from "../src/rendering/document-preview";
import { HtmlDocumentPreview } from "../src/rendering/DocumentPreviewHost";
import { latestWebViewProps } from "./mocks/ReactNativeWebView";

const getTransferAccess = () =>
  Promise.resolve({ authorization: "Bearer test", baseUrl: "https://example.test" });

it("keeps interactive HTML scrolling inside its WebView gesture boundary", () => {
  render(<HtmlDocumentPreview source="<iframe srcdoc='<main>Visualization</main>'></iframe>" />);

  expect(latestWebViewProps?.nestedScrollEnabled).toBe(true);
});

it("opens every text-backed attachment on a page rather than in a sheet", () => {
  expect(documentPreviewSurface("html")).toBe("fullscreen");
  expect(documentPreviewSurface("markdown")).toBe("fullscreen");
  expect(documentPreviewSurface("text")).toBe("fullscreen");
});

it("dispatches attachment URLs and typed files to their dedicated presentations", () => {
  const shared = {
    itemId: "item-1",
    key: "attachment-1",
    kind: "file" as const,
    origin: "agent" as const,
    turnId: "turn-1",
  };

  expect(
    attachmentPresentationTarget(
      { ...shared, name: "Project dashboard", path: null, url: "https://example.test/dashboard" },
      "/workspace",
      getTransferAccess,
    ),
  ).toEqual({
    kind: "browser",
    title: "Project dashboard",
    url: "https://example.test/dashboard",
  });
  expect(
    attachmentPresentationTarget(
      { ...shared, name: "visualization.html", path: null, url: "https://example.test/view" },
      "/workspace",
      getTransferAccess,
    ),
  ).toMatchObject({ kind: "document", request: { kind: "html" } });
  expect(
    attachmentPresentationTarget(
      { ...shared, name: "README.md", path: "docs/README.md", url: null },
      "/workspace",
      getTransferAccess,
    ),
  ).toMatchObject({
    kind: "document",
    request: { kind: "markdown", path: "/workspace/docs/README.md" },
  });
  expect(
    attachmentPresentationTarget(
      {
        ...shared,
        name: "Composer.tsx:41",
        path: "src/Composer.tsx:41:7",
        url: null,
      },
      "/workspace",
      getTransferAccess,
    ),
  ).toMatchObject({
    kind: "codeDocument",
    request: { column: 7, kind: "text", line: 41, path: "/workspace/src/Composer.tsx" },
  });
  expect(
    attachmentPresentationTarget(
      { ...shared, name: "package.json", path: "package.json:12", url: null },
      "/workspace",
      getTransferAccess,
    ),
  ).toMatchObject({
    kind: "codeDocument",
    request: { kind: "text", line: 12, path: "/workspace/package.json" },
  });
  expect(
    attachmentPresentationTarget(
      {
        ...shared,
        kind: "image",
        name: "screenshot",
        path: "artifacts/screenshot",
        url: null,
      },
      "/workspace",
      getTransferAccess,
    ),
  ).toMatchObject({ kind: "document", request: { kind: "image" } });
  expect(
    attachmentPresentationTarget(
      { ...shared, name: "demo.mp4", path: "artifacts/demo.mp4", url: null },
      "/workspace",
      getTransferAccess,
    ),
  ).toMatchObject({ kind: "document", request: { kind: "download" } });
  expect(
    attachmentPresentationTarget(
      { ...shared, name: "archive.zip", path: "artifacts/archive.zip", url: null },
      "/workspace",
      getTransferAccess,
    ),
  ).toMatchObject({ kind: "download", request: { kind: "download" } });
});
