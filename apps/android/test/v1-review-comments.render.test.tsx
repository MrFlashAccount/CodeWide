import { act, renderHook } from "@testing-library/react-native";
import { createLineCommentDrafts } from "../src/features/review/comments/lineCommentDrafts";
import { useLineCommentVoice } from "../src/features/review/comments/lineCommentVoice";
import { useReviewComments } from "../src/features/review/comments/reviewComments";
import { useReviewAttachmentIds } from "../src/features/composer/attachments/reviewAdmission";
import type { CodeReviewLineReference } from "../src/features/review/comments/reviewComment";
import type { AppVoiceInputRuntime } from "../src/ui/VoiceInputRuntime";

// WHY: the Android permission bridge cannot run in Node; the line composer only asks whether capture is allowed.
jest.mock("../src/ui/use-microphone-access", () => ({
  useMicrophoneAccess: () => ({
    allowCapture: () => true,
    granted: true,
    run: (operation: () => Promise<void>) => {
      void operation();
    },
  }),
}));

type Binding = Parameters<NonNullable<AppVoiceInputRuntime["controller"]>["bind"]>[0];

/** A retained voice controller that records the binding each recording starts with. */
function voiceRuntime(bindings: Binding[]): AppVoiceInputRuntime {
  const resolved = async () => Promise.resolve();
  return {
    controller: {
      activeCaptureScope: () => null,
      bind: (binding) => {
        bindings.push(binding);
      },
      clearPendingSelection: () => undefined,
      finish: resolved,
      level: () => 0,
      retry: resolved,
      subscribeActiveCapture: () => () => undefined,
      subscribeLevel: () => () => undefined,
      toggle: resolved,
      unbind: () => undefined,
    },
    resources: null,
    scopePrefix: "review-window",
    thread: null,
  };
}

it("keeps a delayed transcript on the line its recording started on", async () => {
  const first: CodeReviewLineReference = { path: "/repo/a.ts", side: "new", line: 10 };
  const second: CodeReviewLineReference = { path: "/repo/b.ts", side: "new", line: 20 };
  const drafts = createLineCommentDrafts("window");
  const bindings: Binding[] = [];
  const runtime = voiceRuntime(bindings);
  const hook = renderHook(
    ({ target }: { readonly target: CodeReviewLineReference }) =>
      useLineCommentVoice({ drafts, runtime, target }),
    { initialProps: { target: first } },
  );
  drafts.write(first, { markdown: "First draft", plainText: "First draft" });
  await act(async () => hook.result.current.toggle());
  const captured = bindings.at(-1);
  expect(captured?.source()).toBe("First draft");

  hook.rerender({ target: second });
  drafts.write(second, { markdown: "Second draft", plainText: "Second draft" });
  act(() => captured?.updateDraft("First transcript"));

  expect(drafts.peek(first).plainText).toBe("First transcript");
  expect(drafts.peek(second).plainText).toBe("Second draft");
  expect(captured?.scope).not.toBe(hook.result.current.scope);
});

it("commits a comment to its captured line without closing another selected line", () => {
  const first: CodeReviewLineReference = { path: "/repo/a.ts", side: "new", line: 10 };
  const second: CodeReviewLineReference = { path: "/repo/b.ts", side: "new", line: 20 };
  const hook = renderHook(() => useReviewComments());
  act(() => hook.result.current.selectLine(second));
  act(() => hook.result.current.commitComment(first, "  First transcript  "));
  expect(hook.result.current.comments).toEqual([
    expect.objectContaining({
      body: "First transcript",
      line: first.line,
      path: first.path,
      side: first.side,
    }),
  ]);
  expect(hook.result.current.selectedReference).toBe(second);
  act(() => hook.result.current.commitComment(second, "Second"));
  expect(hook.result.current.selectedReference).toBeNull();
});

it("acknowledges only the sent review attachment and retains a newer attachment in the same conversation", () => {
  const hook = renderHook(({ scope }) => useReviewAttachmentIds(scope), {
    initialProps: { scope: "first" },
  });
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
