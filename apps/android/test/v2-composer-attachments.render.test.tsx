import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";

import { useEvent } from "../src/react/useEvent";
import { ComposerAttachmentDraft } from "../src/v2/application/composer/composerAttachmentDraft";
import type {
  ComposerAttachmentTransport,
  LocalComposerAttachment,
} from "../src/v2/application/ports/composerAttachmentTransport";
import { savedServerId } from "../src/v2/domain/ids";
import { ChatComposer } from "../src/v2/features/composer/ChatComposer";
import type { ComposerTextInputProps } from "../src/v2/presentation/input/ComposerView";

describe("V2 composer attachment presentation", () => {
  it("allows attachment-only submission and clears drafts only after acceptance", async () => {
    const draft = createDraft();
    await draft.attachText("evidence.txt", "text/plain", "evidence");
    const onSubmit = jest
      .fn<(text: string) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    render(<ChatComposer attachmentDraft={draft} disabled={false} onSubmit={onSubmit} />);

    expect(screen.getByText("evidence.txt")).toBeTruthy();
    expect(screen.getByLabelText("Send message").props.accessibilityState.disabled).toBe(false);

    await act(async () => fireEvent.press(screen.getByLabelText("Send message")));
    expect(screen.getByText("evidence.txt")).toBeTruthy();

    await act(async () => fireEvent.press(screen.getByLabelText("Send message")));
    expect(screen.queryByText("evidence.txt")).toBeNull();
    expect(onSubmit).toHaveBeenNthCalledWith(1, "");
    expect(onSubmit).toHaveBeenNthCalledWith(2, "");
  });

  it("turns the untouched native large-paste payload into a draft file", async () => {
    const draft = createDraft();
    const onTextChange = jest.fn();
    const onSubmit = jest.fn(async () => false);
    render(
      <ChatComposer
        attachmentDraft={draft}
        disabled={false}
        InputComponent={LargePasteTestInput}
        onSubmit={onSubmit}
        onTextChange={onTextChange}
        text="before after"
      />,
    );

    await act(async () => fireEvent.press(screen.getByLabelText("Paste large text")));

    expect(onTextChange).toHaveBeenCalledWith("before after");
    expect(draft.snapshot().value.items).toMatchObject([
      { mediaType: "text/plain", name: expect.stringMatching(/^pasted-snippet-/u) },
    ]);
  });
});

function LargePasteTestInput(props: ComposerTextInputProps): React.JSX.Element {
  const emit = useEvent(() => {
    props.onLargePaste({ end: 7, start: 7, text: "x".repeat(10_001) });
  });
  return (
    <Pressable accessibilityLabel="Paste large text" onPress={emit}>
      <Text>Paste</Text>
    </Pressable>
  );
}

function createDraft(): ComposerAttachmentDraft {
  let nextId = 0;
  function local(name: string, mediaType: string, sizeBytes: number): LocalComposerAttachment {
    nextId += 1;
    return { handle: `local-${nextId}`, mediaType, name, sizeBytes };
  }
  const transport: ComposerAttachmentTransport = {
    createBytes: (name, mediaType, value) => local(name, mediaType, value.byteLength),
    createText: (name, mediaType, value) => local(name, mediaType, value.length),
    pick: async () => null,
    reference: (attachment) => ({
      mediaType: attachment.mediaType,
      name: attachment.name,
      sizeBytes: attachment.sizeBytes,
      token: attachment.handle,
    }),
    release: jest.fn(),
    restore: () => null,
    upload: () => ({
      cancel: jest.fn(),
      promise: Promise.resolve({ attachmentId: "remote", discard: async () => undefined }),
    }),
  };
  return new ComposerAttachmentDraft({
    now: () => 0,
    savedServerId: savedServerId("server-1"),
    target: { threadId: null, workspace: null },
    transport,
  });
}
