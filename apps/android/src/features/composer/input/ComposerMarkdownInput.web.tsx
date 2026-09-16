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
  const selection = useRef({ end: props.value.length, start: props.value.length });
  const insertText = useEvent((text: string) => {
    const start = Math.min(selection.current.start, selection.current.end);
    const end = Math.max(selection.current.start, selection.current.end);
    props.onChangeText(`${props.value.slice(0, start)}${text}${props.value.slice(end)}`);
  });
  useImperativeHandle(
    ref,
    () => ({
      focus: () => input.current?.focus(),
      getMarkdown: async () => {
        await Promise.resolve();
        return props.value;
      },
      insertCode: () => undefined,
      insertLinkedText: (text) => {
        insertText(text);
      },
      insertText,
      startMention: () => undefined,
      toggleOrderedList: () => undefined,
      toggleUnorderedList: () => undefined,
    }),
    [insertText, props.value],
  );
  return (
    <AppTextInput
      accessibilityLabel={props.accessibilityLabel}
      multiline
      onChangeText={props.onChangeText}
      onSelectionChange={(event) => {
        selection.current = event.nativeEvent.selection;
        props.onSelectionChange?.(event.nativeEvent.selection);
      }}
      placeholder={props.placeholder}
      placeholderTextColor="#777"
      ref={input}
      scrollEnabled={props.scrollEnabled}
      selection={props.selection}
      style={props.style}
      value={props.value}
      voiceInput={false}
      {...(props.largePasteThreshold === undefined || props.onLargePaste === undefined
        ? {}
        : {
            largePasteThreshold: props.largePasteThreshold,
            onLargePaste: props.onLargePaste,
          })}
    />
  );
}
