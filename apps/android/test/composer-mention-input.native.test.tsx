import { ComposerEditor } from "../src/features/composer/ComposerEditor";
import { act, fireEvent, render as renderNative, waitFor } from "@testing-library/react-native";
import { HeroUINativeProviderRaw } from "heroui-native/provider-raw";
import { PortalHost } from "heroui-native/portal";
import { Popover } from "heroui-native/popover";
import { StyleSheet } from "react-native";
import type { EnrichedMarkdownTextInputProps } from "react-native-enriched-markdown";
import { ComposerMentionInput } from "../src/features/composer/input/ComposerMentionInput.native";
import { ComposerMarkdownInput } from "../src/features/composer/input/ComposerMarkdownInput.native";
import { searchComposerTrialMentions } from "../src/features/composer/input/composer-editor-trial";
import { colors, radii, spacing, touchTarget, typeScale } from "../src/theme";
import ComposerEditorTrial from "../src/features/composer/input/ComposerEditorTrial.native";
import { Children, isValidElement, type ReactNode } from "react";

const mockEditor = {
  focus: jest.fn(),
  setValue: jest.fn(),
  setSelection: jest.fn(),
  startMention: jest.fn(),
  insertMention: jest.fn(),
  insertLink: jest.fn(),
  insertText: jest.fn(),
  insertCode: jest.fn(),
  toggleBold: jest.fn(),
  toggleItalic: jest.fn(),
  toggleUnorderedList: jest.fn(),
  toggleOrderedList: jest.fn(),
  getMarkdown: jest.fn<Promise<string>, []>(),
};

// WHY: Expo's filesystem bridge cannot initialize in Node. Icon-less composer
// fixtures still exercise the real popup, plugin-icon fallback and editor.
jest.mock("expo-file-system/legacy", () => ({ cacheDirectory: null }));

// WHY: The native editor requires Fabric and Android/iOS. This adapter test
// replaces only its platform API; it does not claim to test native editing.
jest.mock("react-native-enriched-markdown", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    EnrichedMarkdownTextInput: React.forwardRef(function Editor(
      props: EnrichedMarkdownTextInputProps,
      ref,
    ) {
      React.useImperativeHandle(ref, () => mockEditor);
      return <View {...props} testID="native-editor" />;
    }),
  };
});

// WHY: Compose's popup window needs Android. Keep the actual CodeWideMenu and
// replace only its native host; closing a popup must still remove its items.
jest.mock("@expo/ui/jetpack-compose", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View, Text } = jest.requireActual<typeof import("react-native")>("react-native");
  const Expanded = React.createContext(false);
  const Host = (props: { children?: ReactNode }) => <View>{props.children}</View>;
  const Menu = (props: { children?: ReactNode; expanded: boolean }) => (
    <Expanded.Provider value={props.expanded}>{props.children}</Expanded.Provider>
  );
  const Items = (props: { children?: ReactNode }) =>
    React.useContext(Expanded) ? <View>{props.children}</View> : null;
  const Item = (props: { children?: ReactNode; onClick?(): void }) => (
    <View onTouchEnd={props.onClick}>{props.children}</View>
  );
  return {
    Box: Host,
    Column: Host,
    Host,
    HorizontalDivider: Host,
    Icon: Host,
    RNHostView: Host,
    Text,
    DropdownMenu: Object.assign(Menu, { Trigger: Host, Items }),
    DropdownMenuItem: Object.assign(Item, { Text: Host, LeadingIcon: Host, TrailingIcon: Host }),
  };
});
jest.mock("@expo/ui/jetpack-compose/modifiers", () => ({
  size: jest.fn(),
  width: jest.fn(),
  height: jest.fn(),
  padding: jest.fn(),
}));

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.useRealTimers());

function render(node: ReactNode) {
  return renderNative(
    <HeroUINativeProviderRaw
      config={{ animation: "disable-all", devInfo: { stylingPrinciples: false } }}
    >
      {node}
      <PortalHost />
    </HeroUINativeProviderRaw>,
  );
}

function mountEditor(onPreviewMarkdown = jest.fn()) {
  return render(
    <ComposerMentionInput
      defaultValue="**Initial**"
      onPreviewMarkdown={onPreviewMarkdown}
      search={searchComposerTrialMentions}
    />,
  );
}

it("starts compact with formatting collapsed and uses the dark composer palette", () => {
  const view = mountEditor();
  expect(view.queryByLabelText("Bold")).toBeNull();
  expect(view.getByLabelText("Composer tools").props.accessibilityState.expanded).toBe(false);
  const editor = view.getByTestId("native-editor");
  // V1's input envelope is the explicit visual contract, not a measured text snapshot.
  expect(editor).toHaveStyle({
    minHeight: touchTarget,
    maxHeight: touchTarget + 4 * typeScale.composerInput.lineHeight,
    color: colors.text,
  });
  expect(editor.props.markdownStyle.h1.color).toBe(colors.text);
  expect(editor.props.markdownStyle.h2.color).toBe(colors.text);
  expect(editor.props.markdownStyle.h5.color).toBe(colors.textMuted);
  expect(editor.props.markdownStyle.strong.color).toBe(colors.text);
  expect(editor.props.markdownStyle.em.color).toBe(colors.text);
  expect(editor.props.markdownStyle.link.color).toBe(colors.text);
  expect(editor.props.markdownStyle.spoiler.backgroundColor).toBe(colors.surfaceContainerHigh);
  expect(editor.props.cursorColor).toBe(colors.text);
  fireEvent.press(view.getByLabelText("Composer tools"));
  expect(view.getByText("Code block")).toBeTruthy();
  expect(view.queryByText("Bold")).toBeNull();
  fireEvent.press(view.getByLabelText("Composer tools"));
  expect(view.queryByLabelText("Bold")).toBeNull();
  expect(view.getByTestId("native-editor").props.defaultValue).toBe("**Initial**");
});

it("fills the composer shell, grows intrinsically and keeps the empty-state placeholder visible", () => {
  const view = render(
    <ComposerMarkdownInput
      accessibilityLabel="Main composer"
      value=""
      placeholder="Message Codex…"
      mentionIndicators={["/"]}
      search={async () => []}
      onChangeText={jest.fn()}
      style={{ flex: 1, flexBasis: 0, minWidth: 0, width: 0, maxHeight: 132 }}
    />,
  );

  const editor = view.getByTestId("native-editor");
  expect(editor).toHaveStyle({
    alignSelf: "stretch",
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: "auto",
    minHeight: touchTarget,
    width: "100%",
    maxHeight: 132,
  });
  expect(editor.props.placeholder).toBe("Message Codex…");
  expect(editor.props.placeholderTextColor).toBe(colors.textDim);
  expect(editor.props.scrollEnabled).toBe(true);
});

it("opens an empty trial composer and previews without clearing the editor", async () => {
  const onClose = jest.fn();
  const view = render(<ComposerEditorTrial onClose={onClose} />);
  expect(view.getByTestId("native-editor").props.defaultValue).toBe("");
  mockEditor.getMarkdown.mockResolvedValueOnce("**Local draft**");
  fireEvent.press(view.getByLabelText("Preview Markdown"));
  await waitFor(() => expect(view.getByText("**Local draft**")).toBeTruthy());
  expect(view.getByTestId("native-editor").props.defaultValue).toBe("");
  fireEvent.press(view.getByLabelText("Close composer trial"));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("focuses before inserting from the native menu and closes it after selection", () => {
  const view = mountEditor();
  fireEvent.press(view.getByLabelText("Composer tools"));
  fireEvent(view.getByText("Skills"), "touchEnd");
  expect(mockEditor.focus).toHaveBeenCalledTimes(1);
  expect(mockEditor.startMention).toHaveBeenCalledWith("/");
  expect(mockEditor.focus.mock.invocationCallOrder[0]).toBeLessThan(
    mockEditor.startMention.mock.invocationCallOrder[0]!,
  );
  expect(view.queryByText("Code block")).toBeNull();
  fireEvent.press(view.getByLabelText("Composer tools"));
  fireEvent(view.getByText("Bulleted list"), "touchEnd");
  expect(mockEditor.toggleUnorderedList).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByLabelText("Composer tools"));
  fireEvent(view.getByText("Code block"), "touchEnd");
  expect(mockEditor.insertCode).toHaveBeenCalledWith(true);
  expect(view.getByTestId("native-editor").props.editableMentions).toBe(true);
});

it("filters suggestions and inserts the selected display name and URL", async () => {
  jest.useFakeTimers();
  const view = mountEditor();
  fireEvent(view.getByTestId("native-editor"), "changeMention", { indicator: "/", text: "rev" });
  await act(async () => {
    await jest.runAllTimersAsync();
  });
  expect(view.getByTestId("composer-input-layout")).toHaveStyle({ position: "static" });
  const popover = view.UNSAFE_getByType(Popover);
  expect(popover.props.isOpen).toBe(true);
  expect(
    view.getByTestId("composer-suggestions-anchor", { includeHiddenElements: true }),
  ).toHaveStyle({ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 });
  expect(
    view.getByTestId("composer-suggestions-anchor", { includeHiddenElements: true }).props
      .pointerEvents,
  ).toBe("none");
  const portal = Children.toArray(popover.props.children)[1];
  if (!isValidElement<{ readonly children?: ReactNode }>(portal))
    throw new Error("Composer suggestions portal is missing");
  const content = portal.props.children;
  if (
    !isValidElement<{
      readonly children?: ReactNode;
      readonly width?: unknown;
      readonly offset?: unknown;
      readonly style?: object;
    }>(content)
  ) {
    throw new Error("Composer suggestions portal content is missing");
  }
  expect(content.props.width).toBe("trigger");
  expect(content.props.offset).toBe(spacing.optical);
  expect(StyleSheet.flatten(content.props.style)).toMatchObject({ borderRadius: radii.composer });
  const popup = content.props.children;
  if (!isValidElement(popup)) throw new Error("Composer suggestions list is missing");
  // Native popup placement is unavailable in Jest; exercise the actual body
  // supplied to the portal after verifying its anchor and sizing contract.
  const suggestions = render(popup);
  expect(suggestions.queryByLabelText("Insert Tests")).toBeNull();
  expect(suggestions.getByLabelText("Composer suggestions")).toHaveStyle({ width: "100%" });
  expect(suggestions.getByTestId("composer-suggestions-scroll").props.nestedScrollEnabled).toBe(
    true,
  );
  expect(suggestions.queryByText("Demo plugin")).toBeNull();
  fireEvent.press(suggestions.getByLabelText("Insert Review"));
  expect(mockEditor.insertMention).toHaveBeenCalledWith(
    "$review",
    "codewide-skill://%2Fdemo%2Freview",
  );
  expect(view.UNSAFE_getByType(Popover).props.isOpen).toBe(false);
});

it("dismisses suggestions on blur, including a still scheduled search", async () => {
  jest.useFakeTimers();
  const view = mountEditor();
  fireEvent(view.getByTestId("native-editor"), "startMention", { indicator: "@" });
  fireEvent(view.getByTestId("native-editor"), "blur");
  await act(async () => {
    await jest.runAllTimersAsync();
  });
  expect(view.queryByLabelText("Composer suggestions")).toBeNull();
});

it("reads Markdown on request, preserves the native result, and prevents concurrent reads", async () => {
  const output = "# Heading\n\n[Review](https://example.com/skills/review) **text**";
  const pending = Promise.withResolvers<string>();
  mockEditor.getMarkdown.mockReturnValueOnce(pending.promise);
  const preview = jest.fn();
  const view = mountEditor(preview);
  expect(mockEditor.getMarkdown).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText("Preview Markdown"));
  fireEvent.press(view.getByLabelText("Preview Markdown"));
  expect(mockEditor.getMarkdown).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText("Preview Markdown").props.accessibilityState.busy).toBe(true);
  await act(async () => {
    pending.resolve(output);
    await pending.promise;
  });
  expect(preview).toHaveBeenCalledWith(output);
  expect(view.getByLabelText("Preview Markdown").props.accessibilityState.busy).toBe(false);
});

it("allows retry after serialization failure without substituting plain text", async () => {
  mockEditor.getMarkdown
    .mockRejectedValueOnce(new Error("native serialization failed"))
    .mockResolvedValueOnce("*Recovered*");
  const preview = jest.fn();
  const view = mountEditor(preview);
  fireEvent.press(view.getByLabelText("Preview Markdown"));
  await waitFor(() => expect(view.getByRole("alert")).toBeTruthy());
  expect(preview).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText("Preview Markdown"));
  await waitFor(() => expect(preview).toHaveBeenCalledWith("*Recovered*"));
  expect(view.queryByRole("alert")).toBeNull();
});

it("does not publish a pending read after the editor is closed", async () => {
  const pending = Promise.withResolvers<string>();
  mockEditor.getMarkdown.mockReturnValueOnce(pending.promise);
  const preview = jest.fn();
  const view = mountEditor(preview);
  fireEvent.press(view.getByLabelText("Preview Markdown"));
  view.unmount();
  await act(async () => {
    pending.resolve("old trial");
    await pending.promise;
  });
  expect(preview).not.toHaveBeenCalled();
});

it("returns a large paste to the attachment owner without committing it to the draft", () => {
  const onChangeText = jest.fn();
  const onLargePaste = jest.fn();
  const view = render(
    <ComposerMarkdownInput
      accessibilityLabel="Large paste composer"
      value="before after"
      placeholder="Message"
      mentionIndicators={["/"]}
      search={async () => []}
      onChangeText={onChangeText}
      largePasteThreshold={10}
      onLargePaste={onLargePaste}
    />,
  );
  fireEvent(view.getByTestId("native-editor"), "changeText", "before 01234567890after");
  expect(onChangeText).not.toHaveBeenCalled();
  expect(onLargePaste).toHaveBeenCalledWith({ text: "01234567890", start: 7, end: 7 });
  expect(mockEditor.setValue).toHaveBeenCalledWith("before after");
  expect(mockEditor.setSelection).toHaveBeenCalledWith(7, 7);
});

it("keeps the resident composer editor mounted while a new chat restores its draft", () => {
  const editorProps: Parameters<typeof ComposerEditor>[0] = {
    voicePhase: "idle", composerScope: "server:first", getTransferAccess: undefined,
    getStableTransferAccess: async () => { throw new Error("No attachment read expected"); },
    composerInputRef: {current: null}, fileAttachmentEnabled: false,
    pastedAttachmentPending: false, attachments: [], handleComposerLargePaste: () => undefined,
    draft: "First draft", handleComposerTextChange: () => undefined,
    handleComposerMarkdownChange: () => undefined, draftSelectionRef: {current: {start:0,end:0}},
    pendingVoiceSelection: null, voiceController: null, searchComposerSuggestions: async () => [],
    selectComposerMention: () => undefined, editingQueuedMessage: false,
    voiceBackend: "remote", voiceResource: null,
  };
  const wrapper = (props: Parameters<typeof ComposerEditor>[0]) => (
    <HeroUINativeProviderRaw config={{animation: "disable-all", devInfo: {stylingPrinciples:false}}}>
      <ComposerEditor {...props} />
      <PortalHost />
    </HeroUINativeProviderRaw>
  );
  const view = renderNative(wrapper(editorProps));
  const residentEditor = view.getByTestId("native-editor");
  const nextProps = {...editorProps, composerScope:"server:second", draft:"Restored second draft", composerInputRef:{current:null}};
  view.rerender(wrapper(nextProps));
  expect(view.getByTestId("native-editor")).toBe(residentEditor);
  expect(mockEditor.setValue).toHaveBeenLastCalledWith("Restored second draft");
});
