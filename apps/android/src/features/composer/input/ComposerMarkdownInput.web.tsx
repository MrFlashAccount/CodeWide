import { useImperativeHandle, useRef, type ComponentRef } from "react";

import { useEvent } from "../../../react/useEvent";
import { AppTextInput } from "../../../ui/Typography";
import type {
  ComposerMarkdownInputHandle,
  ComposerMarkdownInputProps,
} from "./ComposerMarkdownInput.types";

/** Web fallback keeps the existing plain TextInput contract. */
export function ComposerMarkdownInput({
  ref,
  ...props
}: ComposerMarkdownInputProps & { readonly ref?: React.Ref<ComposerMarkdownInputHandle> }) {
  const input = useRef<ComponentRef<typeof AppTextInput>>(null);
  const selection = useRef({ start: props.value.length, end: props.value.length });
  const insertText = useEvent((text: string) => {
    const start = Math.min(selection.current.start, selection.current.end);
    const end = Math.max(selection.current.start, selection.current.end);
    props.onChangeText(`${props.value.slice(0, start)}${text}${props.value.slice(end)}`);
  });
  useImperativeHandle(
    ref,
    () => ({
      focus: () => input.current?.focus(),
      getMarkdown: async () => props.value,
      insertCode: () => undefined,
      insertLinkedText: (text) => insertText(text),
      insertText,
      startMention: () => undefined,
      toggleOrderedList: () => undefined,
      toggleUnorderedList: () => undefined,
    }),
    [insertText, props.value],
  );
  return (
    <AppTextInput
      ref={input}
      voiceInput={false}
      accessibilityLabel={props.accessibilityLabel}
      value={props.value}
      onChangeText={props.onChangeText}
      onSelectionChange={(event) => {
        selection.current = event.nativeEvent.selection;
        props.onSelectionChange?.(event.nativeEvent.selection);
      }}
      selection={props.selection}
      placeholder={props.placeholder}
      placeholderTextColor="#777"
      multiline
      scrollEnabled={props.scrollEnabled}
      style={props.style}
      {...(props.largePasteThreshold === undefined || props.onLargePaste === undefined
        ? {}
        : {
            largePasteThreshold: props.largePasteThreshold,
            onLargePaste: props.onLargePaste,
          })}
    />
  );
}
