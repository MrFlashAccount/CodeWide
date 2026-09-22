import { fireEvent, render, screen } from "@testing-library/react-native";

import type { StoredDraftAttachment } from "../src/data/thread-ui-state-types";
import { ComposerAttachmentTray } from "../src/rendering/ComposerAttachmentTray";
import { ComposerGoalAttachment } from "../src/features/goal/ComposerGoalAttachment";
import {
  ImagePreviewContext,
  type ImagePreviewController,
} from "../src/rendering/imagePreviewController";
import { AppRootProviders } from "../src/ui/AppRootProviders";

it("renders Goal as a removable composer attachment without a second editor", () => {
  const close = jest.fn();
  render(<ComposerGoalAttachment onClose={close} />);

  expect(screen.getByTestId("composer-goal-attachment")).toBeVisible();
  expect(screen.getByText("flag-outline")).toBeTruthy();
  expect(screen.getByText("Goal")).toBeTruthy();
  expect(screen.queryByLabelText("Goal objective")).toBeNull();
  expect(screen.queryByLabelText("Goal token budget")).toBeNull();
  expect(screen.queryByText("Create goal")).toBeNull();

  fireEvent.press(screen.getByLabelText("Remove Goal"));
  expect(close).toHaveBeenCalledTimes(1);
});

it("renders Goal inside the same horizontal attachment strip as files", () => {
  const attachment: StoredDraftAttachment = {
    id: "attachment",
    kind: "file",
    name: "reference.md",
    path: "goal/reference.md",
    rootId: "attachments",
  };
  render(
    <AppRootProviders>
      <ComposerAttachmentTray
        attachments={[attachment]}
        getAccess={async () => ({ authorization: "test", baseUrl: "https://example.test" })}
        onRemove={jest.fn()}
        scope="test-scope"
        startAttachment={<ComposerGoalAttachment onClose={jest.fn()} />}
      />
    </AppRootProviders>,
  );

  const strip = screen.getByTestId("composer-attachment-strip");
  expect(strip.props.horizontal).toBe(true);
  expect(screen.getByTestId("composer-goal-attachment")).toBeVisible();
  expect(screen.getByLabelText("Open reference.md")).toBeVisible();
});

it("keeps image detail available when a composer attachment uses a local thumbnail", () => {
  const open = jest.fn();
  const getAccess = jest.fn(async () => ({
    authorization: "test",
    baseUrl: "https://example.test",
  }));
  const imagePreview: ImagePreviewController = {
    createSession: () => <></>,
    open,
    register: () => () => undefined,
    registerAnnotationHandler: () => () => undefined,
  };
  const attachment: StoredDraftAttachment = {
    id: "image",
    kind: "image",
    name: "screenshot.jpg",
    path: "sessions/thread/files/screenshot.jpg",
    preview: {
      bytes: 12_000,
      mimeType: "image/jpeg",
      text: null,
      uri: "file:///cache/screenshot-thumbnail.jpg",
    },
    rootId: "attachments",
  };
  render(
    <AppRootProviders>
      <ImagePreviewContext.Provider value={imagePreview}>
        <ComposerAttachmentTray
          attachments={[attachment]}
          getAccess={getAccess}
          onRemove={jest.fn()}
          scope="test-scope"
        />
      </ImagePreviewContext.Provider>
    </AppRootProviders>,
  );

  expect(getAccess).not.toHaveBeenCalled();
  fireEvent.press(screen.getByLabelText("Open screenshot.jpg"));
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({
      detail: expect.objectContaining({
        accessScope: "test-scope",
        getAccess,
        source: {
          kind: "scoped",
          path: "sessions/thread/files/screenshot.jpg",
          rootId: "attachments",
        },
      }),
      source: { uri: "file:///cache/screenshot-thumbnail.jpg" },
    }),
    expect.any(Object),
  );
  expect(getAccess).not.toHaveBeenCalled();
});
