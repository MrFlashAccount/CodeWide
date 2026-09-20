import { act, renderHook } from "@testing-library/react-native";

import type { StoredDraftAttachment } from "../src/data/thread-ui-state-types";
import { useComposerSession } from "../src/features/composer/composerSession";
import { TEST_COMPOSER_PREFERENCES } from "./composer-session-fixture";

const attachment: StoredDraftAttachment = {
  id: "attachment",
  kind: "file",
  name: "notes.txt",
  path: "thread/notes.txt",
  rootId: "attachments",
};

function projection(plainText: string, attachments: StoredDraftAttachment[] = []) {
  return { attachments, plainText, preferences: TEST_COMPOSER_PREFERENCES };
}

it("keeps local text until persistence acknowledges it, then accepts later projections", () => {
  const hook = renderHook((value: ReturnType<typeof projection>) => useComposerSession("thread", value), {
    initialProps: projection("persisted"),
  });

  act(() => {
    hook.result.current.updateText({ markdown: "**local**", plainText: "local" });
  });
  hook.rerender(projection("stale"));
  expect(hook.result.current.snapshot).toEqual(
    expect.objectContaining({ markdown: "**local**", plainText: "local" }),
  );

  hook.rerender(projection("local"));
  hook.rerender(projection("remote"));
  expect(hook.result.current.snapshot).toEqual(
    expect.objectContaining({ markdown: "remote", plainText: "remote" }),
  );
});

it("applies paired native text and markdown changes without leaving Send disabled", () => {
  const hook = renderHook(() => {
    const composer = useComposerSession("thread", projection(""));
    return {
      composer,
      sendDisabled: composer.snapshot.plainText.trim() === "",
    };
  });

  act(() => {
    hook.result.current.composer.updateText({ markdown: "message", plainText: "message" });
    hook.result.current.composer.updateText({ markdown: "**message**", plainText: "message" });
  });

  expect(hook.result.current.sendDisabled).toBe(false);
  expect(hook.result.current.composer.snapshot).toEqual(
    expect.objectContaining({ markdown: "**message**", plainText: "message" }),
  );
});

it("keeps a local attachment set through a stale durable projection", () => {
  const hook = renderHook((value: ReturnType<typeof projection>) => useComposerSession("thread", value), {
    initialProps: projection(""),
  });

  act(() => {
    hook.result.current.updateAttachments([attachment]);
  });
  hook.rerender(projection("", []));
  expect(hook.result.current.snapshot.attachments).toEqual([attachment]);

  hook.rerender(projection("", [attachment]));
  hook.rerender(projection("", []));
  expect(hook.result.current.snapshot.attachments).toEqual([]);
});
