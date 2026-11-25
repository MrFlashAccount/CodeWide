import { act, renderHook } from "@testing-library/react-native";
import { useState } from "react";
import { composerUploads } from "../src/data/composer-uploads";
import type { FileTransferController } from "../src/data/file-transfer-controller";
import type { TransferAccess } from "../src/data/private-transfer";
import { useComposerAccessoryActions } from "../src/features/composer/ComposerAccessoryTray";
import { useAttachmentAdmission } from "../src/features/composer/attachments/attachmentAdmission";
import { usePhotoAdmission } from "../src/features/composer/attachments/photoAdmission";
import type { useComposerDraftCommands } from "../src/features/composer/draft";
import { getAppDialogRequest, resetAppDialog } from "./mocks/AppDialog";
import { composerSessionFixture } from "./composer-session-fixture";

const mockStartUpload = jest.fn();
const mockLogError = jest.fn();

jest.mock("expo-image-picker", () => ({
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
}));
jest.mock("expo-file-system", () => {
  class MockFile {
    readonly exists = true;
    readonly size = 2048;
    readonly type = "image/jpeg";
    readonly uri: string;
    constructor(mockUri: string) {
      this.uri = mockUri;
    }
  }
  return { Directory: class {}, File: MockFile, FileMode: {}, Paths: { cache: "cache" } };
});
jest.mock("../src/native/file-transfer", () => ({
  ...jest.requireActual<object>("../src/native/file-transfer"),
  startUpload: (...args: unknown[]): unknown => mockStartUpload(...args),
}));
jest.mock("../src/observability/logger", () => ({
  appLogger: { errorCaught: (input: unknown): unknown => mockLogError(input) },
}));

const imagePicker = jest.requireMock<{
  launchCameraAsync: jest.Mock;
  launchImageLibraryAsync: jest.Mock;
  requestCameraPermissionsAsync: jest.Mock;
}>("expo-image-picker");
const UPLOAD_SCOPE = "composer:photo-test";

beforeEach(() => {
  jest.clearAllMocks();
  resetAppDialog();
  for (const entry of composerUploads.entries(UPLOAD_SCOPE)) {
    composerUploads.remove(UPLOAD_SCOPE, entry.attachment.id);
  }
  mockStartUpload.mockReturnValue({ cancel: jest.fn(), promise: new Promise(() => undefined) });
});

function renderAdmission() {
  // WHY: Photo admission reads only these qualified capabilities; the draft owner and transfer
  // controller have no narrower test constructors, and none of their other members is reached.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const captureDraftMutations = (() => ({
    updateAttachments: jest.fn(),
  })) as unknown as ReturnType<typeof useComposerDraftCommands>["captureDraftMutations"];
  // WHY: Same as above: admission only checks that a controller exists before staging.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const fileTransferController = {} as FileTransferController;
  const getTransferAccess = async (): Promise<TransferAccess> =>
    Promise.reject(new Error("not reached"));
  const composerSession = composerSessionFixture("");
  const dismissComposerKeyboardForOverlay = jest.fn();
  const setComposerTrayVisible = jest.fn();
  return renderHook(() => {
    const { captureStageAttachment, fileAttachmentEnabled } = useAttachmentAdmission({
      attachmentCount: 0,
      captureDraftMutations,
      composerScope: "composer:photo-test",
      composerSession,
      composerUploadScope: UPLOAD_SCOPE,
      dismissComposerKeyboardForOverlay,
      draftConnectionId: "connection",
      draftThreadId: "thread",
      fileTransferController,
      getStableTransferAccess: getTransferAccess,
      getTransferAccess,
      queuedComposerEdit: null,
      setComposerTrayVisible,
      upsertDraftAttachment: async () => undefined,
    });
    return usePhotoAdmission({
      captureStageAttachment,
      composerSession,
      composerUploadScope: UPLOAD_SCOPE,
      dismissComposerKeyboardForOverlay,
      fileAttachmentEnabled,
      setComposerTrayVisible,
    });
  });
}

function renderMenu(fileAttachmentEnabled: boolean) {
  const openComposerFeature = jest.fn();
  const hook = renderHook(() => {
    const [, setComposerTrayVisible] = useState(true);
    return useComposerAccessoryActions({
      fileAttachmentEnabled,
      goalEnabled: true,
      openComposerFeature,
      setComposerTrayVisible,
      skillsEnabled: true,
      terminalEnabled: true,
    });
  });
  return { hook, openComposerFeature };
}

it("starts the composer menu with Camera and Add photo before Attach file", () => {
  const { hook, openComposerFeature } = renderMenu(true);
  const actions = hook.result.current.anchoredComposerActions;

  expect(actions.map((action) => action.label)).toEqual([
    "Camera",
    "Add photo",
    "Attach file",
    "Drawing",
    "Terminal",
    "Skills",
    "Goal",
  ]);
  expect(actions.slice(0, 2)).toEqual([
    { disabled: false, icon: "camera-outline", id: "camera", label: "Camera" },
    { disabled: false, icon: "images-outline", id: "photos", label: "Add photo" },
  ]);

  act(() => {
    hook.result.current.handleAnchoredComposerAction("camera");
    hook.result.current.handleAnchoredComposerAction("photos");
  });
  expect(openComposerFeature.mock.calls).toEqual([["camera"], ["photos"]]);
});

it("disables Camera and Add photo together with Attach file", () => {
  const { hook } = renderMenu(false);
  const disabled = new Map(
    hook.result.current.anchoredComposerActions.map((action) => [action.id, action.disabled]),
  );

  expect(disabled.get("files")).toBe(true);
  expect(disabled.get("photos")).toBe(true);
  expect(disabled.get("camera")).toBe(true);
});

it("stages every picked photo as a composer image attachment upload", async () => {
  imagePicker.launchImageLibraryAsync.mockResolvedValue({
    assets: [
      { fileName: "beach.png", mimeType: "image/png", uri: "file:///cache/beach.png" },
      { fileName: null, mimeType: "image/jpeg", uri: "file:///cache/picked.jpeg" },
    ],
    canceled: false,
  });
  const hook = renderAdmission();

  await act(async () => {
    await hook.result.current.pickComposerPhotos();
  });

  const [options] = imagePicker.launchImageLibraryAsync.mock.calls[0] as [Record<string, unknown>];
  expect(options).toMatchObject({ allowsMultipleSelection: true, mediaTypes: "images" });
  const entries = composerUploads.entries(UPLOAD_SCOPE);
  expect(entries.map((entry) => entry.attachment.kind)).toEqual(["image", "image"]);
  expect(entries[0]?.attachment.name).toBe("beach.png");
  expect(entries[1]?.attachment.name).toMatch(/\.jpg$/u);
  expect(entries.map((entry) => entry.preview.uri)).toEqual([
    "file:///cache/beach.png",
    "file:///cache/picked.jpeg",
  ]);
  expect(entries.every((entry) => entry.state.status === "uploading")).toBe(true);
  expect(mockStartUpload).toHaveBeenCalledTimes(2);
  expect(getAppDialogRequest()).toBeNull();
});

it("takes a camera photo after the permission is granted", async () => {
  imagePicker.requestCameraPermissionsAsync.mockResolvedValue({ canAskAgain: true, granted: true });
  imagePicker.launchCameraAsync.mockResolvedValue({
    assets: [{ fileName: "shot.jpeg", mimeType: "image/jpeg", uri: "file:///cache/shot.jpeg" }],
    canceled: false,
  });
  const hook = renderAdmission();

  await act(async () => {
    await hook.result.current.takeComposerPhoto();
  });

  expect(composerUploads.entries(UPLOAD_SCOPE).map((entry) => entry.attachment.name)).toEqual([
    "shot.jpeg",
  ]);
});

it("adds nothing when the picker or the camera is cancelled", async () => {
  imagePicker.launchImageLibraryAsync.mockResolvedValue({ assets: null, canceled: true });
  imagePicker.requestCameraPermissionsAsync.mockResolvedValue({ canAskAgain: true, granted: true });
  imagePicker.launchCameraAsync.mockResolvedValue({ assets: null, canceled: true });
  const hook = renderAdmission();

  await act(async () => {
    await hook.result.current.pickComposerPhotos();
    await hook.result.current.takeComposerPhoto();
  });

  expect(composerUploads.entries(UPLOAD_SCOPE)).toEqual([]);
  expect(mockStartUpload).not.toHaveBeenCalled();
  expect(getAppDialogRequest()).toBeNull();
});

it("explains a denied camera permission instead of failing silently", async () => {
  imagePicker.requestCameraPermissionsAsync.mockResolvedValue({
    canAskAgain: false,
    granted: false,
  });
  const hook = renderAdmission();

  await act(async () => {
    await hook.result.current.takeComposerPhoto();
  });

  expect(imagePicker.launchCameraAsync).not.toHaveBeenCalled();
  expect(composerUploads.entries(UPLOAD_SCOPE)).toEqual([]);
  expect(getAppDialogRequest()).toMatchObject({
    actions: [{ text: "Cancel" }, { text: "Open settings" }],
    title: "Camera access needed",
  });
});

it("surfaces and logs the real picker failure", async () => {
  const failure = new Error("Photo picker is unavailable");
  imagePicker.launchImageLibraryAsync.mockRejectedValue(failure);
  const hook = renderAdmission();

  await act(async () => {
    await hook.result.current.pickComposerPhotos();
  });

  expect(getAppDialogRequest()).toMatchObject({
    message: "Photo picker is unavailable",
    title: "Could not add photo",
  });
  expect(mockLogError).toHaveBeenCalledWith({
    error: failure,
    event: "composer.photo_picker.failed",
  });
  expect(composerUploads.entries(UPLOAD_SCOPE)).toEqual([]);
});
