import { createCommentDraft } from "../src/features/pullRequestDetail/conversation/commentDraft";
import {
  attachmentMarkdown,
  formatComment,
} from "../src/features/pullRequestDetail/conversation/commentMarkdown";

jest.mock("../src/native/file-transfer", () => ({
  pickUploadFile: jest.fn(async () => ({ mimeType: "image/png", name: "fold [1].png", size: 55 })),
  selectedUploadUri: () => "content://test-image",
}));

it("uploads the selected image on Send, then retries just the comment after a write failure", async () => {
  const draft = createCommentDraft();
  const upload = jest.fn(async () => "https://forge.test/file(1)");
  draft.change("Before");
  await draft.pick();
  expect(upload).not.toHaveBeenCalled();
  const publish = jest.fn(async () => ({ status: "failed", message: "Offline" }) as const);
  await expect(draft.send(publish, upload)).resolves.toBe(false);
  const markdown = "Before\n\n![fold \\[1\\].png](https://forge.test/file%281%29)";
  expect(publish).toHaveBeenCalledWith(markdown);
  const success = jest.fn(async () => ({ status: "sent" }) as const);
  await expect(draft.send(success, upload)).resolves.toBe(true);
  expect(success).toHaveBeenCalledWith(markdown);
  expect(upload).toHaveBeenCalledTimes(1);
  expect(draft.source.peek()).toBe("");
});

it("retains an unuploaded file and its caption when the upload fails", async () => {
  const draft = createCommentDraft();
  draft.change("Details");
  await draft.pick();
  const publish = jest.fn(async () => ({ status: "sent" }) as const);
  await draft.send(publish, async () => {
    throw new Error("File type refused");
  });
  expect(publish).not.toHaveBeenCalled();
  expect(draft.state.peek()).toEqual({ status: "failed", message: "File type refused" });
  expect(draft.files.peek()[0]?.name).toBe("fold [1].png");
  draft.remove("content://test-image");
  await draft.send(publish, null);
  expect(publish).toHaveBeenCalledWith("Details");
});

it("adds a checklist to selected complete lines and keeps adjacent lines untouched", () => {
  expect(formatComment("one\ntwo\nthree", { start: 0, end: 8 }, "task").text).toBe(
    "- [ ] one\n- [ ] two\nthree",
  );
  expect(attachmentMarkdown("demo.mp4", "https://forge.test/demo", false)).toBe(
    "[demo.mp4](https://forge.test/demo)",
  );
});
