import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { findNodeHandle, StyleSheet, View } from "react-native";
import { useSelector } from "@legendapp/state/react";
import { Popover, type PopoverTriggerRef } from "heroui-native/popover";
import {
  EnrichedMarkdownTextInput,
  type EnrichedMarkdownTextInputInstance,
  type MarkdownTextInputStyle,
} from "react-native-enriched-markdown";

import { colors, radii, spacing, touchTarget, typeScale } from "../theme";
import { installLargePasteInterceptor, type LargePasteEvent } from "../native/large-paste";
import { useEvent } from "../react/useEvent";
import { productFonts } from "./product-fonts";
import { ComposerSuggestionsPopup } from "./ComposerSuggestionsPopup";
import { ComposerSuggestions } from "./composer-suggestions";
import type { ComposerMention } from "./composer-mentions";
import type { ComposerMarkdownInputHandle, ComposerMarkdownInputProps } from "./ComposerMarkdownInput.types";

const markdownStyle = {
  strong: { color: colors.text },
  em: { color: colors.text },
  link: { color: colors.text, backgroundColor: colors.accentMuted, underline: false },
  spoiler: { color: colors.text, backgroundColor: colors.surfaceContainerHigh },
  h1: { color: colors.text, fontSize: typeScale.heading.fontSize },
  h2: { color: colors.text, fontSize: typeScale.title.fontSize },
  h3: { color: colors.text, fontSize: typeScale.composerInput.fontSize },
  h4: { color: colors.text, fontSize: typeScale.composerInput.fontSize },
  h5: { color: colors.textMuted, fontSize: typeScale.body.fontSize },
  h6: { color: colors.textMuted, fontSize: typeScale.body.fontSize },
} satisfies MarkdownTextInputStyle;

type MentionEvent = { readonly indicator: string; readonly text?: string };

/** Native Markdown editor plus its transient suggestion-search owner. */
export function ComposerMarkdownInput({ ref, ...props }: ComposerMarkdownInputProps & { readonly ref?: React.Ref<ComposerMarkdownInputHandle> }) {
  const externalValue = props.value;
  const externalSelection = props.selection;
  const notifyExternalMarkdown = props.onChangeMarkdown;
  const root = useRef<View>(null);
  const editor = useRef<EnrichedMarkdownTextInputInstance>(null);
  const largePasteId = useId();
  const lastPlainText = useRef(externalValue);
  const lastMarkdown = useRef(externalValue);
  const discardNextMarkdown = useRef(false);
  const suggestionAnchor = useRef<PopoverTriggerRef>(null);
  const [suggestions] = useState(() => new ComposerSuggestions());
  const suggestionState = useSelector(() => suggestions.state$.get().value);
  const suggestionPopupOpen = suggestionState.status === "ready"
    || suggestionState.status === "error"
    || (suggestionState.status === "loading" && suggestionState.items.length > 0);

  useEffect(() => () => suggestions.close(), [suggestions]);

  useLayoutEffect(() => {
    if (externalValue === lastPlainText.current) return;
    lastPlainText.current = externalValue;
    lastMarkdown.current = externalValue;
    editor.current?.setValue(externalValue);
    notifyExternalMarkdown?.(externalValue);
  }, [externalValue, notifyExternalMarkdown]);

  useLayoutEffect(() => {
    if (externalSelection === undefined) return;
    editor.current?.setSelection(externalSelection.start, externalSelection.end);
  }, [externalSelection]);

  useEffect(() => {
    if (suggestionPopupOpen) suggestionAnchor.current?.open();
  }, [suggestionPopupOpen]);

  useImperativeHandle(ref, () => ({
    focus: () => editor.current?.focus(),
    getMarkdown: async () => await editor.current?.getMarkdown() ?? lastMarkdown.current,
    insertCode: (block) => editor.current?.insertCode(block),
    insertLinkedText: (text, url) => editor.current?.insertLink(text, url),
    insertText: (text) => editor.current?.insertText(text),
    startMention: (indicator) => editor.current?.startMention(indicator),
    toggleOrderedList: () => editor.current?.toggleOrderedList(),
    toggleUnorderedList: () => editor.current?.toggleUnorderedList(),
  }), []);

  const search = useEvent((event: MentionEvent) => {
    if (event.indicator !== "/" && event.indicator !== "@") return;
    suggestionAnchor.current?.open();
    suggestions.search({ indicator: event.indicator, text: event.text ?? "" }, props.search);
  });
  const close = useEvent(() => suggestions.close());
  const changeSuggestionPopup = useEvent((open: boolean) => {
    if (!open) suggestions.close();
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
    const paste = threshold === undefined || onLargePaste === undefined
      ? null
      : insertedText(previous, next);
    if (paste !== null && threshold !== undefined && onLargePaste !== undefined && paste.text.length > threshold) {
      discardNextMarkdown.current = true;
      editor.current?.setValue(previous);
      editor.current?.setSelection(paste.start, paste.start);
      onLargePaste(paste);
      return;
    }
    lastPlainText.current = next;
    props.onChangeText(next);
  });
  const changeMarkdown = useEvent((next: string) => {
    if (discardNextMarkdown.current) {
      discardNextMarkdown.current = false;
      return;
    }
    lastMarkdown.current = next;
    props.onChangeMarkdown?.(next);
  });
  const changeSelection = useEvent((next: { start: number; end: number }) => {
    props.onSelectionChange?.(next);
  });
  const captureNativeLargePaste = useEvent((event: LargePasteEvent) => {
    props.onLargePaste?.(event);
  });
  const largePasteEnabled = props.largePasteThreshold !== undefined && props.onLargePaste !== undefined;

  useLayoutEffect(() => {
    if (!largePasteEnabled || props.largePasteThreshold === undefined) return;
    const reactTag = findNodeHandle(root.current);
    if (reactTag === null) return;
    return installLargePasteInterceptor(
      reactTag,
      `composer-large-paste-${largePasteId}`,
      props.largePasteThreshold,
      captureNativeLargePaste,
    ) ?? undefined;
  }, [captureNativeLargePaste, largePasteEnabled, largePasteId, props.largePasteThreshold]);

  return (
    <View ref={root} testID="composer-input-layout" collapsable={false} style={styles.root}>
      <Popover presentation="popover" isOpen={suggestionPopupOpen} onOpenChange={changeSuggestionPopup} style={styles.popoverRoot}>
        <Popover.Trigger ref={suggestionAnchor} asChild>
          <View
            testID="composer-suggestions-anchor"
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            collapsable={false}
            style={styles.suggestionAnchor}
          />
        </Popover.Trigger>
        <Popover.Portal unstable_accessibilityContainerViewIsModal={false}>
          <Popover.Content
            presentation="popover"
            placement="top"
            align="start"
            offset={spacing.optical}
            width="trigger"
            background={null}
            style={styles.suggestionPopover}
          >
            <ComposerSuggestionsPopup state={suggestionState} {...(props.getTransferAccess === undefined ? {} : { getTransferAccess: props.getTransferAccess })} onSelect={choose} />
          </Popover.Content>
        </Popover.Portal>
      </Popover>
      <EnrichedMarkdownTextInput
        ref={editor}
        accessibilityLabel={props.accessibilityLabel}
        defaultValue={props.value}
        placeholder={props.placeholder}
        placeholderTextColor={colors.textDim}
        style={StyleSheet.flatten([props.style, styles.input])}
        multiline
        scrollEnabled={props.scrollEnabled ?? true}
        cursorColor={colors.text}
        selectionColor={`${colors.primary}40`}
        linkRegex={null}
        markdownStyle={markdownStyle}
        mentionIndicators={[...props.mentionIndicators]}
        editableMentions
        onStartMention={search}
        onChangeMention={search}
        onEndMention={close}
        onChangeText={changeText}
        onChangeMarkdown={changeMarkdown}
        onChangeSelection={changeSelection}
        onBlur={close}
      />
    </View>
  );
}

function insertedText(previous: string, next: string): { text: string; start: number; end: number } | null {
  if (next === previous) return null;
  let start = 0;
  while (start < previous.length && previous[start] === next[start]) start += 1;
  let suffix = 0;
  while (
    suffix < previous.length - start
    && previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
  ) suffix += 1;
  return {
    text: next.slice(start, next.length - suffix),
    start,
    end: previous.length - suffix,
  };
}

const styles = StyleSheet.create({
  // The editor participates in row layout but does not form the anchor's
  // containing block. The outer composer shell therefore owns popup width.
  root: { position: "static", flex: 1, flexBasis: 0, flexShrink: 1, minWidth: 0, minHeight: touchTarget, overflow: "visible" },
  popoverRoot: { position: "static" },
  suggestionAnchor: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  suggestionPopover: { padding: 0, elevation: 8, backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderWidth: 1, borderRadius: radii.composer, overflow: "hidden" },
  // The native editor owns intrinsic content height up to the caller's
  // maxHeight. A column-axis flex basis of zero would pin it to one line.
  input: { alignSelf: "stretch", flexGrow: 0, flexShrink: 1, flexBasis: "auto", minWidth: 0, width: "100%", minHeight: touchTarget, color: colors.text, fontFamily: productFonts.regular },
});
