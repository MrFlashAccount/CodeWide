import { useSelector } from "@legendapp/state/react";
import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { findNodeHandle, StyleSheet, View } from "react-native";
import {
  EnrichedMarkdownTextInput,
  type EnrichedMarkdownTextInputInstance,
} from "react-native-enriched-markdown";
import { installLargePasteInterceptor, type LargePasteEvent } from "../../../native/large-paste";
import { useConstant } from "../../../react/useConstant";
import { useEvent } from "../../../react/useEvent";
import { colors } from "../../../theme";
import type { ComposerMention } from "./composer-mentions";
import { ComposerSuggestions } from "./composer-suggestions";
import type {
  ComposerMarkdownInputHandle,
  ComposerMarkdownInputProps,
} from "./ComposerMarkdownInput.types";
import { ComposerSuggestionsPopup } from "./ComposerSuggestionsPopup";
import { insertedText } from "./insertedText";
import { markdownStyle, styles } from "./nativeEditorStyles";

export type MentionEvent = { readonly indicator: string; readonly text?: string };

export function ComposerMarkdownInput({
  ref,
  ...props
}: ComposerMarkdownInputProps & { readonly ref?: React.Ref<ComposerMarkdownInputHandle> }) {
  const externalValue = props.value;
  const externalSelection = props.selection;
  const root = useRef<View>(null);
  const editor = useRef<EnrichedMarkdownTextInputInstance>(null);
  const largePasteId = useId();
  const lastPlainText = useRef(externalValue);
  const lastMarkdown = useRef(externalValue);
  const discardNextMarkdown = useRef(false);
  const suggestions = useConstant(() => new ComposerSuggestions());
  const suggestionState = useSelector(() => suggestions.state$.get().value);
  const suggestionPopupOpen =
    suggestionState.status === "ready" ||
    suggestionState.status === "error" ||
    (suggestionState.status === "loading" && suggestionState.items.length > 0);

  useEffect(
    () => () => {
      suggestions.close();
    },
    [suggestions],
  );

  useLayoutEffect(() => {
    if (externalValue === lastPlainText.current) {
      return;
    }
    lastPlainText.current = externalValue;
    lastMarkdown.current = externalValue;
    editor.current?.setValue(externalValue);
  }, [externalValue]);

  useLayoutEffect(() => {
    if (externalSelection === undefined) {
      return;
    }
    editor.current?.setSelection(externalSelection.start, externalSelection.end);
  }, [externalSelection]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editor.current?.focus(),
      getValue: async () => ({
        markdown: (await editor.current?.getMarkdown()) ?? lastMarkdown.current,
        plainText: lastPlainText.current,
      }),
      insertCode: (block) => editor.current?.insertCode(block),
      insertLinkedText: (text, url) => editor.current?.insertLink(text, url),
      insertText: (text) => editor.current?.insertText(text),
      startMention: (indicator) => editor.current?.startMention(indicator),
      toggleOrderedList: () => editor.current?.toggleOrderedList(),
      toggleUnorderedList: () => editor.current?.toggleUnorderedList(),
    }),
    [],
  );

  const search = useEvent((event: MentionEvent) => {
    if (event.indicator !== "/" && event.indicator !== "@") {
      return;
    }
    suggestions.search({ indicator: event.indicator, text: event.text ?? "" }, props.search);
  });
  const close = useEvent(() => {
    suggestions.close();
  });
  const choose = useEvent((mention: ComposerMention) => {
    editor.current?.insertMention(mention.insertText, mention.url);
    props.onSelectMention?.(mention);
    suggestions.close();
  });
  const changeText = useEvent((next: string) => {
    const previous = lastPlainText.current;
    const threshold = props.largePasteThreshold;
    const onLargePaste = props.onLargePaste;
    const paste =
      threshold === undefined || onLargePaste === undefined ? null : insertedText(previous, next);
    if (
      paste !== null &&
      threshold !== undefined &&
      onLargePaste !== undefined &&
      paste.text.length > threshold
    ) {
      discardNextMarkdown.current = true;
      editor.current?.setValue(previous);
      editor.current?.setSelection(paste.start, paste.start);
      onLargePaste(paste);
      return;
    }
    lastPlainText.current = next;
    lastMarkdown.current = next;
  });
  const changeMarkdown = useEvent((next: string) => {
    if (discardNextMarkdown.current) {
      discardNextMarkdown.current = false;
      return;
    }
    lastMarkdown.current = next;
    props.onChangeValue({ markdown: next, plainText: lastPlainText.current });
  });
  const changeSelection = useEvent((next: { end: number; start: number }) => {
    props.onSelectionChange?.(next);
  });
  const captureNativeLargePaste = useEvent((event: LargePasteEvent) => {
    props.onLargePaste?.(event);
  });
  const largePasteEnabled =
    props.largePasteThreshold !== undefined && props.onLargePaste !== undefined;

  useLayoutEffect(() => {
    if (!largePasteEnabled || props.largePasteThreshold === undefined) {
      return undefined;
    }
    const reactTag = findNodeHandle(root.current);
    if (reactTag === null) {
      return undefined;
    }
    return (
      installLargePasteInterceptor(
        reactTag,
        `composer-large-paste-${largePasteId}`,
        props.largePasteThreshold,
        captureNativeLargePaste,
      ) ?? undefined
    );
  }, [captureNativeLargePaste, largePasteEnabled, largePasteId, props.largePasteThreshold]);

  return (
    <View collapsable={false} ref={root} style={styles.root} testID="composer-input-layout">
      {suggestionPopupOpen && (
        <View style={styles.suggestionMenu} testID="composer-suggestions-anchor">
          <ComposerSuggestionsPopup
            state={suggestionState}
            {...(props.getTransferAccess === undefined
              ? {}
              : { getTransferAccess: props.getTransferAccess })}
            onSelect={choose}
          />
        </View>
      )}
      <EnrichedMarkdownTextInput
        accessibilityLabel={props.accessibilityLabel}
        cursorColor={colors.text}
        defaultValue={props.value}
        editableMentions
        linkRegex={null}
        markdownStyle={markdownStyle}
        mentionIndicators={[...props.mentionIndicators]}
        multiline
        onBlur={close}
        onChangeMarkdown={changeMarkdown}
        onChangeMention={search}
        onChangeSelection={changeSelection}
        onChangeText={changeText}
        onEndMention={close}
        onStartMention={search}
        placeholder={props.placeholder}
        placeholderTextColor={colors.textDim}
        ref={editor}
        scrollEnabled={props.scrollEnabled ?? true}
        selectionColor={`${colors.primary}40`}
        style={StyleSheet.flatten([props.style, styles.input])}
      />
    </View>
  );
}
