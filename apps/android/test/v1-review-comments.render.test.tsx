import { act, renderHook } from "@testing-library/react-native";
import { useReviewComments } from "../src/features/review/reviewComments";
import { useReviewAttachmentIds } from "../src/features/composer/attachments/reviewAdmission";
import type { CodeReviewLineReference } from "../src/rendering/code-review";

it("keeps a delayed transcript on its captured line and commits without closing another selected line", () => {
  const first: CodeReviewLineReference = { path: "/repo/a.ts", side: "new", line: 10 };
  const second: CodeReviewLineReference = { path: "/repo/b.ts", side: "new", line: 20 };
  const hook = renderHook(() => useReviewComments());
  act(() => hook.result.current.selectLine(first));
  const updateCaptured = hook.result.current.updateReferenceDraft;
  act(() => hook.result.current.updateCommentDraft("First draft"));
  act(() => hook.result.current.selectLine(second));
  act(() => hook.result.current.updateCommentDraft("Second draft"));
  expect(hook.result.current.updateReferenceDraft).toBe(updateCaptured);
  act(() => updateCaptured(first, "First transcript"));
  expect(hook.result.current.commentDraft).toBe("Second draft");
  act(() => hook.result.current.commitComment(first, "  First transcript  "));
  expect(hook.result.current.comments).toEqual([expect.objectContaining({ path: first.path, line: first.line, side: first.side, body: "First transcript" })]);
  expect(hook.result.current.selectedReference).toBe(second);
  expect(hook.result.current.commentDraft).toBe("Second draft");
  act(() => hook.result.current.selectLine(first));
  expect(hook.result.current.commentDraft).toBe("");
});

it("acknowledges only the sent review attachment and retains a newer attachment in the same conversation", () => {
  const hook = renderHook(({ scope }) => useReviewAttachmentIds(scope), { initialProps: { scope: "first" } });
  act(() => hook.result.current.setContentReviewAttachmentId("first", "sent"));
  act(() => hook.result.current.setContentReviewAttachmentId("first", "newer"));
  act(() => hook.result.current.clearContentReviewAttachmentId("first", "sent"));
  expect(hook.result.current.contentReviewAttachmentId).toBe("newer");
  hook.rerender({ scope: "second" });
  expect(hook.result.current.contentReviewAttachmentId).toBeNull();
  act(() => hook.result.current.setContentReviewAttachmentId("second", "second-review"));
  act(() => hook.result.current.clearContentReviewAttachmentId("first", "newer"));
  expect(hook.result.current.contentReviewAttachmentId).toBe("second-review");
  hook.rerender({ scope: "first" });
  expect(hook.result.current.contentReviewAttachmentId).toBeNull();
});
