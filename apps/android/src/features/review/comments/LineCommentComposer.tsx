import { Ionicons } from "@expo/vector-icons";
import { useSelector } from "@legendapp/state/react";
import { useLayoutEffect, useRef, useState, type ComponentRef } from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";

import type { VoiceInputRow } from "../../../data/workspace-resource-database";
import { useEvent } from "../../../react/useEvent";
import { colors, controlHitSlop, iconSize, spacing } from "../../../theme";
import { useKeyboardDockBottomInset } from "../../../ui/keyboardDockInset";
import { surfaceToneCanvasColor, useSurfaceTone } from "../../../ui/surfaceTone";
import { AppText as Text } from "../../../ui/Typography";
import { useAndroidBackHandler } from "../../../ui/use-android-back-handler";
import type { AppVoiceInputRuntime } from "../../../ui/VoiceInputRuntime";
import { ComposerMicrophone } from "../../composer/ComposerMicrophone";
import { ComposerSendButton } from "../../composer/ComposerSendButton";
import { ComposerMarkdownInput } from "../../composer/input/ComposerMarkdownInput";
import { VoiceCaptureStatus } from "../../composer/voice/VoiceCaptureStatus";
import { lineCommentComposerStyles as styles } from "./LineCommentComposer.styles";
import type { LineCommentDrafts, LineCommentText } from "./lineCommentDrafts";
import { useLineCommentVoice, type LineCommentVoice } from "./lineCommentVoice";

/** The line the composer comments on. */
export type LineCommentTarget = {
  readonly line: number;
  readonly path: string;
  readonly side: "new" | "old";
};

/** Props of the docked line comment composer. */
export type LineCommentComposerProps = {
  /** The review window's per-line text; it outlives the composer. */
  readonly drafts: LineCommentDrafts;
  /** Closes the composer: on ✕, on Back, and at once when Send hands the text over. */
  readonly onClose: () => void;
  /** Receives the trimmed comment for its line after the composer asked to close; the owner saves it. */
  readonly onSubmit: (target: LineCommentTarget, body: string) => void;
  /** Accessibility label of Send, which names where the comment goes. */
  readonly submitLabel: string;
  /** The anchored line; changing it re-anchors the open composer. */
  readonly target: LineCommentTarget;
  /** The app's retained voice input; `null` hides dictation. */
  readonly voice: AppVoiceInputRuntime | null;
};

/** Line comments offer no `/` or `@` suggestions. */
const NO_MENTIONS: Promise<readonly never[]> = Promise.resolve([]);
async function noMentions(): Promise<readonly never[]> {
  return NO_MENTIONS;
}

/**
 * The line comment composer docked above the keyboard, like a chat reply: an
 * anchor row (`file · line N`, Expand, Close) over the chat composer's input
 * row, whose one trailing action is the microphone while there is nothing to
 * send and Send once there is. Expand fills the dock with the same editor; it
 * switches without a layout transition, because the dock's frame already moves
 * with the keyboard every frame and a transition would trail it.
 * Send never waits for a write: the composer closes at once and hands the text
 * to its owner.
 */
export function LineCommentComposer(
  props: LineCommentComposerProps & {
    /** Receives the collapsed composer's height, which the content keeps clear. */
    readonly onCollapsedHeight: (height: number) => void;
  },
): React.JSX.Element {
  const { drafts, target } = props;
  const voice = useLineCommentVoice({ drafts, runtime: props.voice, target });
  const [expanded, setExpanded] = useState(false);
  const bottomInset = useKeyboardDockBottomInset();
  const canvas = surfaceToneCanvasColor(useSurfaceTone());
  const text = useSelector(() => drafts.read(target));
  const close = useEvent((): void => {
    voice.release();
    props.onClose();
  });
  useAndroidBackHandler(true, close);
  const submit = useEvent((): void => {
    const line = target;
    const body = commentBody(drafts.peek(line));
    if (body.length === 0) {
      return;
    }
    voice.release();
    drafts.clear(line);
    props.onClose();
    props.onSubmit(line, body);
  });
  const toggleExpanded = useEvent((): void => {
    setExpanded(!expanded);
  });
  const measure = useEvent((event: LayoutChangeEvent): void => {
    if (!expanded) {
      props.onCollapsedHeight(event.nativeEvent.layout.height);
    }
  });
  return (
    <View
      onLayout={measure}
      style={[
        styles.panel,
        { backgroundColor: canvas, paddingBottom: spacing.xs + bottomInset },
        expanded && styles.expanded,
      ]}
      testID="review-line-composer"
    >
      <AnchorRow
        expanded={expanded}
        onClose={close}
        onToggleExpanded={toggleExpanded}
        target={target}
      />
      <View style={[styles.inputRow, expanded && styles.expanded]}>
        <InputShell drafts={drafts} expanded={expanded} target={target} text={text} voice={voice} />
        <TrailingAction
          hasText={text.plainText.trim() !== ""}
          onSend={submit}
          submitLabel={props.submitLabel}
          voice={voice}
        />
      </View>
      <VoiceError resource={voice.resource} />
    </View>
  );
}

/** `file · line N` like a reply quote, then Expand and Close. */
function AnchorRow({
  expanded,
  onClose,
  onToggleExpanded,
  target,
}: {
  readonly expanded: boolean;
  readonly onClose: () => void;
  readonly onToggleExpanded: () => void;
  readonly target: LineCommentTarget;
}): React.JSX.Element {
  const line = `${target.side === "old" ? "old line" : "line"} ${String(target.line)}`;
  return (
    <View style={styles.anchorRow}>
      <Ionicons color={colors.textMuted} name="chatbubble-outline" size={iconSize.inline} />
      <Text
        accessibilityLabel={`Comment on ${line} of ${target.path}`}
        ellipsizeMode="middle"
        numberOfLines={1}
        style={styles.anchor}
        testID="review-line-composer-anchor"
      >
        {`${fileName(target.path)} · ${line}`}
      </Text>
      <Pressable
        accessibilityLabel={expanded ? "Collapse" : "Expand"}
        accessibilityRole="button"
        hitSlop={controlHitSlop.compact}
        onPress={onToggleExpanded}
        style={styles.iconButton}
      >
        <Ionicons
          color={colors.textMuted}
          name={expanded ? "contract-outline" : "expand-outline"}
          size={iconSize.inline}
        />
      </Pressable>
      <Pressable
        accessibilityLabel="Close"
        accessibilityRole="button"
        hitSlop={controlHitSlop.compact}
        onPress={onClose}
        style={styles.iconButton}
      >
        <Ionicons color={colors.textMuted} name="close" size={iconSize.action} />
      </Pressable>
    </View>
  );
}

/** The chat composer's input shell around the editor or the recording meter. */
function InputShell(props: {
  readonly drafts: LineCommentDrafts;
  readonly expanded: boolean;
  readonly target: LineCommentTarget;
  readonly text: LineCommentText;
  readonly voice: LineCommentVoice;
}): React.JSX.Element {
  return (
    <View style={[styles.inputShell, props.expanded && styles.shellExpanded]}>
      <CommentEditor {...props} />
    </View>
  );
}

/**
 * The microphone while there is nothing to send (or a dictation is running or
 * can be retried), else Send. Without dictation an empty composer shows a
 * disabled Send.
 */
function TrailingAction({
  hasText,
  onSend,
  submitLabel,
  voice,
}: {
  readonly hasText: boolean;
  readonly onSend: () => void;
  readonly submitLabel: string;
  readonly voice: LineCommentVoice;
}): React.JSX.Element {
  const phase = phaseOf(voice.resource);
  const retryAvailable = voice.resource?.retryAvailable ?? false;
  if (voice.scope !== null && (!hasText || phase !== "idle" || retryAvailable)) {
    return (
      <ComposerMicrophone
        disabled={false}
        finishVoice={voice.stop}
        microphoneAccess={voice.microphoneAccess}
        microphoneButtonRef={voice.microphoneButtonRef}
        retryVoice={voice.retry}
        toggleVoice={voice.toggle}
        voiceDisabled={voice.voiceDisabled}
        voicePhase={phase}
        voiceRetryAvailable={retryAvailable}
      />
    );
  }
  return (
    <ComposerSendButton
      accessibilityLabel={submitLabel}
      disabled={!hasText}
      onPress={onSend}
      testID="review-comment-send"
    />
  );
}

function VoiceError({
  resource,
}: {
  readonly resource: VoiceInputRow | null;
}): React.JSX.Element | null {
  const error = resource?.error ?? null;
  return error === null ? null : (
    <Text accessibilityLiveRegion="polite" style={styles.error}>
      {error}
    </Text>
  );
}

/**
 * The Markdown editor, or the recording meter while the line is dictated, as
 * in the chat composer. A transcript lands in the line's retained text and the
 * editor shows it when it returns.
 */
function CommentEditor({
  drafts,
  expanded,
  target,
  text,
  voice,
}: {
  readonly drafts: LineCommentDrafts;
  readonly expanded: boolean;
  readonly target: LineCommentTarget;
  readonly text: LineCommentText;
  readonly voice: LineCommentVoice;
}): React.JSX.Element {
  const { resource, scope } = voice;
  const change = useEvent((value: LineCommentText): void => {
    drafts.write(target, value);
  });
  if (
    resource !== null &&
    scope !== null &&
    (resource.phase === "recording" || resource.phase === "finishing")
  ) {
    return (
      <VoiceCaptureStatus
        backend={resource.backend}
        controller={voice.controller}
        phase={resource.phase}
        scope={scope}
        startedAt={resource.updatedAt}
      />
    );
  }
  return (
    <FocusedEditor
      expanded={expanded}
      onChange={change}
      onSelectionChange={voice.select}
      selection={resource?.pendingSelection ?? null}
      value={text.plainText}
    />
  );
}

/** The editor, focused when it mounts so the composer opens to type. */
function FocusedEditor({
  expanded,
  onChange,
  onSelectionChange,
  selection,
  value,
}: {
  readonly expanded: boolean;
  readonly onChange: (value: LineCommentText) => void;
  readonly onSelectionChange: (selection: { readonly end: number; readonly start: number }) => void;
  readonly selection: { readonly end: number; readonly start: number } | null;
  readonly value: string;
}): React.JSX.Element {
  const editor = useRef<ComponentRef<typeof ComposerMarkdownInput>>(null);
  // Focus is an imperative handle of the mounted editor.
  useLayoutEffect(() => {
    editor.current?.focus();
  }, []);
  return (
    <ComposerMarkdownInput
      accessibilityLabel="Comment"
      mentionIndicators={[]}
      onChangeValue={onChange}
      onSelectionChange={onSelectionChange}
      placeholder="Comment on this line…"
      ref={editor}
      search={noMentions}
      style={[styles.editor, expanded && styles.editorExpanded]}
      value={value}
      {...(selection === null ? {} : { selection })}
    />
  );
}

function phaseOf(resource: VoiceInputRow | null): VoiceInputRow["phase"] {
  return resource?.phase ?? "idle";
}

/** The last path segment, which the anchor row names; the full path is spoken. */
function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The Markdown when the editor has it, else the plain text; trimmed. */
function commentBody(text: LineCommentText): string {
  return (text.markdown.trim().length > 0 ? text.markdown : text.plainText).trim();
}
