import { ComposerEditor } from "../src/features/composer/ComposerEditor";
import { act, fireEvent, render as renderNative } from "@testing-library/react-native";
import type { EnrichedMarkdownTextInputProps } from "react-native-enriched-markdown";
import { ComposerMarkdownInput } from "../src/features/composer/input/ComposerMarkdownInput.native";
import { colors, touchTarget, typeScale } from "../src/theme";
import type { ReactNode } from "react";

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
  return renderNative(node);
}

const reviewSuggestion = {
  description: "Review code",
  group: "Built-in",
  id: "review",
  insertText: "$review",
  kind: "skill",
  label: "Review",
  name: "review",
  path: "/review",
  plugin: null,
  url: "codewide-skill://%2Fdemo%2Freview",
} as const;

function mountEditor() {
  return render(
    <ComposerMarkdownInput
      accessibilityLabel="Message Codex"
      mentionIndicators={["/", "@"]}
      onChangeValue={jest.fn()}
      placeholder="Message Codex…"
      search={async (query) =>
        query.text === "" || reviewSuggestion.label.toLowerCase().includes(query.text.toLowerCase())
          ? [reviewSuggestion]
          : []
      }
      style={{ maxHeight: touchTarget + 4 * typeScale.composerInput.lineHeight }}
      value="**Initial**"
    />,
  );
}

it("uses the dark composer palette", () => {
  const view = mountEditor();
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
      onChangeValue={jest.fn()}
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

it("publishes one coherent text snapshot after native Markdown compilation", () => {
  const onChangeValue = jest.fn();
  const view = render(
    <ComposerMarkdownInput
      accessibilityLabel="Main composer"
      mentionIndicators={["/"]}
      onChangeValue={onChangeValue}
      placeholder="Message"
      search={async () => []}
      value="before"
    />,
  );

  fireEvent(view.getByTestId("native-editor"), "changeText", "after");
  expect(onChangeValue).not.toHaveBeenCalled();
  fireEvent(view.getByTestId("native-editor"), "changeMarkdown", "**after**");
  expect(onChangeValue).toHaveBeenCalledTimes(1);
  expect(onChangeValue).toHaveBeenCalledWith({
    markdown: "**after**",
    plainText: "after",
  });
});

it("filters suggestions and inserts the selected display name and URL", async () => {
  jest.useFakeTimers();
  const view = mountEditor();
  fireEvent(view.getByTestId("native-editor"), "changeMention", { indicator: "/", text: "rev" });
  await act(async () => {
    await jest.runAllTimersAsync();
  });
  expect(view.getByTestId("composer-input-layout")).toHaveStyle({ position: "relative" });
  expect(
    view.getByTestId("composer-suggestions-anchor", { includeHiddenElements: true }),
  ).toHaveStyle({ bottom: "100%", left: 0, position: "absolute", right: 0 });
  expect(view.queryByLabelText("Insert Tests")).toBeNull();
  expect(view.getByLabelText("Composer suggestions")).toHaveStyle({ width: "100%" });
  expect(view.getByTestId("composer-suggestions-scroll").props.nestedScrollEnabled).toBe(true);
  expect(view.queryByText("Built-in")).toBeNull();
  fireEvent.press(view.getByLabelText("Insert Review"));
  expect(mockEditor.insertMention).toHaveBeenCalledWith(
    "$review",
    "codewide-skill://%2Fdemo%2Freview",
  );
  expect(view.queryByLabelText("Composer suggestions")).toBeNull();
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

it("returns a large paste to the attachment owner without committing it to the draft", () => {
  const onChangeValue = jest.fn();
  const onLargePaste = jest.fn();
  const view = render(
    <ComposerMarkdownInput
      accessibilityLabel="Large paste composer"
      value="before after"
      placeholder="Message"
      mentionIndicators={["/"]}
      search={async () => []}
      onChangeValue={onChangeValue}
      largePasteThreshold={10}
      onLargePaste={onLargePaste}
    />,
  );
  fireEvent(view.getByTestId("native-editor"), "changeText", "before 01234567890after");
  expect(onChangeValue).not.toHaveBeenCalled();
  expect(onLargePaste).toHaveBeenCalledWith({ text: "01234567890", start: 7, end: 7 });
  expect(mockEditor.setValue).toHaveBeenCalledWith("before after");
  expect(mockEditor.setSelection).toHaveBeenCalledWith(7, 7);
});

it("keeps the resident composer editor mounted while a new chat restores its draft", () => {
  const editorProps: Parameters<typeof ComposerEditor>[0] = {
    voicePhase: "idle",
    composerScope: "server:first",
    getTransferAccess: undefined,
    getStableTransferAccess: async () => {
      throw new Error("No attachment read expected");
    },
    composerInputRef: { current: null },
    fileAttachmentEnabled: false,
    pastedAttachmentPending: false,
    attachments: [],
    handleComposerLargePaste: () => undefined,
    draft: "First draft",
    handleComposerTextChange: () => undefined,
    draftSelectionRef: { current: { start: 0, end: 0 } },
    pendingVoiceSelection: null,
    voiceController: null,
    searchComposerSuggestions: async () => [],
    selectComposerMention: () => undefined,
    editingQueuedMessage: false,
    voiceBackend: "remote",
    voiceResource: null,
  };
  const wrapper = (props: Parameters<typeof ComposerEditor>[0]) => <ComposerEditor {...props} />;
  const view = renderNative(wrapper(editorProps));
  const residentEditor = view.getByTestId("native-editor");
  const nextProps = {
    ...editorProps,
    composerScope: "server:second",
    draft: "Restored second draft",
    composerInputRef: { current: null },
  };
  view.rerender(wrapper(nextProps));
  expect(view.getByTestId("native-editor")).toBe(residentEditor);
  expect(mockEditor.setValue).toHaveBeenLastCalledWith("Restored second draft");
});
