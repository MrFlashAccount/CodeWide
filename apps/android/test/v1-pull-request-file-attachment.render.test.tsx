import { MAX_TURN_ATTACHMENTS } from "@codewide/sync-client";
import { headRevision, parsePullRequestKeyParam } from "../src/data/forgeContract";
import type { PullRequestFile } from "../src/data/forgeMutationContract";
import { attachReviewFile } from "../src/routeComposition/attachReviewFile";
import { reviewChatDraftId } from "../src/routeComposition/reviewChatDraft";
import { overview91 } from "./fixtures/forgeWireFixtures";

const mockAsk = jest.fn();
const mockAttachments = jest.fn();
const mockUpsert = jest.fn();
const mockRead = jest.fn();
const mockUpload = jest.fn();
const mockCreate = jest.fn((name: string, mimeType: string, source: string) => ({
  name,
  mimeType,
  source,
}));
jest.mock("../src/data/forgeRuntime", () => ({
  forgeResources: { fileContent: { preload: (...args: unknown[]) => mockRead(...args) } },
}));
jest.mock("../src/features/workspace/createWorkspaceFeatures", () => ({
  workspaceFeatures: {
    composer: {
      loadDraftAttachments: (...args: unknown[]) => mockAttachments(...args),
      upsertDraftAttachment: (...args: unknown[]) => mockUpsert(...args),
    },
    pullRequestDetail: { ensureReviewChat: (...args: unknown[]) => mockAsk(...args) },
  },
}));
jest.mock("../src/native/file-transfer", () => ({
  createTextUpload: (n: string, m: string, s: string) => mockCreate(n, m, s),
  startUpload: (...args: unknown[]) => ({ promise: mockUpload(...args) }),
}));

const pullRequest = parsePullRequestKeyParam(overview91.pullRequest);
if (pullRequest === null) throw Error("Invalid fixture PR");
const target = { connectionId: "local", pullRequest };
const file: PullRequestFile = {
  path: "src/notify.rs",
  previousPath: null,
  status: "modified",
  additions: 1,
  deletions: 1,
  patch: { state: "present", hunks: [], text: "@@ -1 +1 @@\n-old\n+new" },
  viewed: { source: "forge", viewed: false },
};
const head = headRevision("fixed-head", "head");

beforeEach(() => {
  jest.clearAllMocks();
  mockAttachments.mockResolvedValue([]);
  mockRead.mockResolvedValue({ state: "text", content: "fn notify() {}" });
  mockUpload.mockResolvedValue(undefined);
  mockUpsert.mockResolvedValue(undefined);
});

it.each([
  ["ready", "the-linked-thread"],
  ["needsWorkspace", reviewChatDraftId(pullRequest)],
])("stages on the exact %s PR composer at the reviewed head", async (kind, scope) => {
  const opening = kind === "ready" ? { kind, threadId: scope } : { kind, candidates: [] };
  mockAsk.mockResolvedValue(opening);
  expect(await attachReviewFile(target, file, head)).toEqual(opening);
  expect(mockAsk).toHaveBeenCalledWith(target, { kind: "ask" });
  expect(mockRead).toHaveBeenCalledWith({ ...target, headRevision: head, path: file.path });
  expect(mockCreate).toHaveBeenCalledWith("notify.rs", "text/plain", "fn notify() {}");
  expect(mockUpsert).toHaveBeenCalledWith(
    target.connectionId,
    scope,
    expect.objectContaining({ name: "notify.rs", rootId: "attachments" }),
    expect.any(Function),
  );
});
it("attaches a deleted file as its recorded patch", async () => {
  mockAsk.mockResolvedValue({ kind: "ready", threadId: "the-linked-thread" });
  await attachReviewFile(target, { ...file, status: "removed" }, head);
  expect(mockRead).not.toHaveBeenCalled();
  expect(mockCreate).toHaveBeenCalledWith(
    "notify.rs.patch",
    "text/x-diff",
    expect.stringContaining("-old\n+new"),
  );
});
it("leaves the composer intact when staging fails or the attachment limit was reached", async () => {
  mockAsk.mockResolvedValue({ kind: "ready", threadId: "the-linked-thread" });
  mockUpload.mockRejectedValueOnce(Error("upload interrupted"));
  await expect(attachReviewFile(target, file, head)).rejects.toThrow("upload interrupted");
  mockAttachments.mockResolvedValue(
    Array.from({ length: MAX_TURN_ATTACHMENTS }, () => ({ name: "existing" })),
  );
  await expect(attachReviewFile(target, file, head)).rejects.toThrow("maximum");
  expect(mockUpload).toHaveBeenCalledTimes(1);
  expect(mockUpsert).not.toHaveBeenCalled();
});
