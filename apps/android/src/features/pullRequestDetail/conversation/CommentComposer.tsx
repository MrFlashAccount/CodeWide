import { Ionicons } from "@expo/vector-icons";
import { useSelector } from "@legendapp/state/react";
import { useRef, useState } from "react";
import {
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  type Text as NativeText,
  type TextInput,
  type TextInputSelectionChangeEvent,
  View,
} from "react-native";

import type { CommentAttachment } from "../../../data/forgeCommentAttachment";
import { useEvent } from "../../../react/useEvent";
import { CompleteMarkdown } from "../../../rendering/CompleteMarkdown";
import { colors, controlSize, iconSize, layoutSize, spacing, typeScale } from "../../../theme";
import { AppSheetScrollView } from "../../../ui/AppSheet";
import { TextShimmer } from "../../../ui/TextShimmer";
import { AppText as Text, AppTextInput } from "../../../ui/Typography";
import type { MessageSendResult } from "../../messageContent/messageContent";
import type { CommentDraft } from "./commentDraft";
import { formatComment, type CommentFormat, type CommentSelection } from "./commentMarkdown";
import { CommentToolbar } from "./CommentToolbar";

const TAB_INDICATOR_HEIGHT = 2;
const ID = "pull-request-new-comment";

/** Full-height Markdown editor for the PR discussion. Preview uses the published comment renderer. */
export function CommentComposer({
  draft,
  onDone,
  onSend,
  onUpload,
}: {
  readonly draft: CommentDraft;
  readonly onDone: () => void;
  readonly onSend: (markdown: string) => Promise<MessageSendResult>;
  readonly onUpload: ((file: CommentAttachment) => Promise<string>) | null;
}): React.JSX.Element {
  const [preview, setPreview] = useState(false);
  const cursor = useRef<CommentSelection>({
    end: draft.source.peek().length,
    start: draft.source.peek().length,
  });
  const [selection, setSelection] = useState<CommentSelection>();
  const editor = useRef<TextInput>(null);
  const source = useSelector(() => draft.source.get());
  const files = useSelector(() => draft.files.get());
  const state = useSelector(() => draft.state.get());
  const pending = state.status === "sending";
  const busy = draft.busy();
  const disabled = busy || emptyDraft(source, files);
  const change = useEvent((text: string) => {
    setSelection(undefined);
    draft.change(text);
  });
  const select = useEvent((event: TextInputSelectionChangeEvent) => {
    cursor.current = event.nativeEvent.selection;
  });
  const format = useEvent((action: CommentFormat) => {
    const edit = formatComment(draft.source.peek(), cursor.current, action);
    draft.change(edit.text);
    cursor.current = edit.selection;
    setSelection(edit.selection);
    editor.current?.focus();
  });
  const showPreview = useEvent(() => {
    Keyboard.dismiss();
    setPreview(true);
  });
  const showEdit = useEvent(() => {
    setSelection(cursor.current);
    setPreview(false);
  });
  const send = useEvent(() => {
    draft.send(onSend, onUpload).then((sent) => {
      if (sent) {
        onDone();
      }
    }, draft.failure);
  });
  const pick = useEvent(() => {
    draft.pick().catch(draft.failure);
  });
  const attach = onUpload === null ? null : pick;
  return (
    <View style={styles.sheet} testID="pull-request-comment-sheet">
      <View style={styles.full} testID={ID}>
        <ComposerHeader
          disabled={disabled}
          pending={pending}
          preview={preview}
          send={send}
          showEdit={showEdit}
          showPreview={showPreview}
        />
        {preview || pending ? (
          <CommentPreview pending={pending} source={source} />
        ) : (
          <AppTextInput
            accessibilityLabel="Comment text"
            editable={!busy}
            multiline
            onChangeText={change}
            onSelectionChange={select}
            placeholder="Add a comment…"
            placeholderTextColor={colors.textDim}
            ref={editor}
            textAlignVertical="top"
            {...(selection === undefined ? {} : { selection })}
            style={styles.input}
            testID={ID + "-editor"}
            value={source}
            voiceInput={false}
          />
        )}
        <DraftAttachments busy={busy} draft={draft} preview={preview} />
        {!preview && !busy ? <CommentToolbar onAttach={attach} onFormat={format} /> : null}
      </View>
    </View>
  );
}

function emptyDraft(text: string, files: readonly CommentAttachment[]): boolean {
  return text.trim().length === 0 && files.length === 0;
}
function DraftAttachments({
  busy,
  draft,
  preview,
}: {
  readonly busy: boolean;
  readonly draft: CommentDraft;
  readonly preview: boolean;
}): React.JSX.Element {
  const files = useSelector(() => draft.files.get());
  const state = useSelector(() => draft.state.get());
  return (
    <>
      {state.status === "failed" ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {state.message}
        </Text>
      ) : null}
      {files.length > 0 ? (
        <ScrollView horizontal keyboardShouldPersistTaps="always" style={styles.files}>
          {files.map((file) => (
            <FileChip busy={busy} draft={draft} file={file} key={file.uri} preview={preview} />
          ))}
        </ScrollView>
      ) : null}
    </>
  );
}
function ComposerHeader({
  disabled,
  pending,
  preview,
  send,
  showEdit,
  showPreview,
}: {
  readonly disabled: boolean;
  readonly pending: boolean;
  readonly preview: boolean;
  readonly send: () => void;
  readonly showEdit: () => void;
  readonly showPreview: () => void;
}): React.JSX.Element {
  return (
    <>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          Comment
        </Text>
        <SendCommentButton disabled={disabled} pending={pending} send={send} />
      </View>
      <View accessibilityRole="tablist" style={styles.tabs}>
        <ModeTab active={!preview} onPress={showEdit} title="Edit" />
        <ModeTab active={preview} onPress={showPreview} title="Preview" />
      </View>
    </>
  );
}
function SendCommentButton({
  disabled,
  pending,
  send,
}: {
  readonly disabled: boolean;
  readonly pending: boolean;
  readonly send: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel="Send comment"
      accessibilityRole="button"
      accessibilityState={{ busy: pending, disabled }}
      disabled={disabled}
      onPress={send}
      style={styles.send}
      testID={ID + "-send"}
    >
      <Ionicons
        color={disabled ? colors.textDim : colors.text}
        name="send"
        size={iconSize.action}
      />
    </Pressable>
  );
}
function CommentPreview({
  pending,
  source,
}: {
  readonly pending: boolean;
  readonly source: string;
}): React.JSX.Element {
  const label = useRef<NativeText>(null);
  return (
    <AppSheetScrollView keyboardShouldPersistTaps="handled" style={styles.full}>
      {pending ? (
        <Text ref={label} style={styles.bodyText} testID={ID + "-pending"}>
          {source}
        </Text>
      ) : source.trim().length > 0 ? (
        <CompleteMarkdown source={source} />
      ) : (
        <Text style={styles.hint}>Nothing to preview yet.</Text>
      )}
      <TextShimmer shimmering={pending} target={label} />
    </AppSheetScrollView>
  );
}

function ModeTab({
  active,
  onPress,
  title,
}: {
  readonly active: boolean;
  readonly onPress: () => void;
  readonly title: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.tab, active && styles.active]}
    >
      <Text style={active ? styles.bodyText : styles.hint}>{title}</Text>
    </Pressable>
  );
}

function FileChip({
  busy,
  draft,
  file,
  preview,
}: {
  readonly busy: boolean;
  readonly draft: CommentDraft;
  readonly file: CommentAttachment;
  readonly preview: boolean;
}): React.JSX.Element {
  const remove = useEvent(() => {
    draft.remove(file.uri);
  });
  return (
    <Pressable
      accessibilityLabel={"Remove " + file.name}
      accessibilityRole="button"
      disabled={busy}
      onPress={remove}
      style={styles.file}
    >
      {preview && file.type.startsWith("image/") ? (
        <Image
          accessibilityLabel={file.name}
          resizeMode="contain"
          source={{ uri: file.uri }}
          style={styles.thumbnail}
        />
      ) : (
        <Ionicons color={colors.textMuted} name="attach-outline" size={iconSize.inline} />
      )}
      <Text style={styles.hint}>{file.name}</Text>
      <Ionicons color={colors.textMuted} name="close" size={iconSize.inline} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  active: { borderColor: colors.text },
  bodyText: {
    ...typeScale.body,
    color: colors.text,
  },
  error: {
    ...typeScale.label,
    color: colors.error,
  },
  file: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: controlSize.touch,
    paddingRight: spacing.md,
  },
  files: { flexGrow: 0 },
  full: {
    flex: 1,
    minHeight: 0,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: controlSize.touch,
  },
  hint: {
    ...typeScale.body,
    color: colors.textMuted,
  },
  input: {
    ...typeScale.body,
    color: colors.text,
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 0,
    paddingVertical: spacing.sm,
  },
  send: {
    alignItems: "center",
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.touch,
  },
  sheet: {
    flex: 1,
    minHeight: 0,
  },
  tab: {
    alignItems: "center",
    borderBottomWidth: TAB_INDICATOR_HEIGHT,
    borderColor: "transparent",
    flex: 1,
    justifyContent: "center",
    minHeight: controlSize.touch,
  },
  tabs: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
  },
  thumbnail: {
    height: controlSize.touch,
    width: layoutSize.row,
  },
  title: {
    ...typeScale.heading,
    color: colors.text,
    flex: 1,
  },
});
