import { useSelector } from "@legendapp/state/react";
import { useLayoutEffect, useRef, type ComponentRef, type ReactNode } from "react";
import { View } from "react-native";

import type { VoiceInputRow } from "../../../data/workspace-resource-database";
import { AppButton } from "../../../presentation/controls/AppButton";
import { useEvent } from "../../../react/useEvent";
import { AppSheet } from "../../../ui/AppSheet";
import { AppText as Text } from "../../../ui/Typography";
import type { AppVoiceInputRuntime } from "../../../ui/VoiceInputRuntime";
import { ComposerMicrophone } from "../../composer/ComposerMicrophone";
import { ComposerMarkdownInput } from "../../composer/input/ComposerMarkdownInput";
import { VoiceCaptureStatus } from "../../composer/voice/VoiceCaptureStatus";
import { commentSheetStyles as styles } from "./CommentSheet.styles";
import type { LineCommentDrafts, LineCommentText } from "./lineCommentDrafts";
import { useLineCommentVoice, type LineCommentVoice } from "./lineCommentVoice";

/** What the sheet comments on. */
export type CommentSheetTarget = {
  readonly line: number;
  readonly path: string;
  readonly side: "new" | "old";
};

/** Props of the line comment composer. */
export type CommentSheetProps = {
  /** Controls between the editor and Send, such as the draft destination. */
  readonly accessory: ReactNode;
  /** The review window's per-line text; it outlives the sheet. */
  readonly drafts: LineCommentDrafts;
  /** Closes the sheet: on dismissal, and at once when Send hands the text over. */
  readonly onDismiss: () => void;
  /**
   * Receives the trimmed comment for `target` after the sheet asked to close;
   * the owner saves it in the background. A dictation still recording is
   * finished first and its final text arrives here once transcribed, possibly
   * after another line's composer opened.
   */
  readonly onSubmit: (body: string) => void;
  readonly submitLabel: string;
  readonly target: CommentSheetTarget;
  /** The app's retained voice input; `null` hides dictation. */
  readonly voice: AppVoiceInputRuntime | null;
};

/** Line comments offer no `/` or `@` suggestions. */
const NO_MENTIONS: Promise<readonly never[]> = Promise.resolve([]);
async function noMentions(): Promise<readonly never[]> {
  return NO_MENTIONS;
}

/**
 * The one line comment composer of the review editor: a Markdown editor that
 * opens focused, dictation through the retained voice controller (the editor
 * yields to the recording meter while it records, as in the chat composer),
 * the caller's accessory and Send. Send never waits for a write: the sheet
 * closes at once and hands the text over. There is no busy state, so the sheet
 * stays dismissible and its drag handle is always shown.
 */
export function CommentSheet(props: CommentSheetProps): React.JSX.Element {
  const voice = useLineCommentVoice({
    drafts: props.drafts,
    runtime: props.voice,
    target: props.target,
  });
  const dismiss = useEvent((): void => {
    voice.release();
    props.onDismiss();
  });
  return (
    <AppSheet
      contentProps={{ dismissLabel: "Close comment" }}
      isOpen
      onOpenChange={(open) => {
        if (!open) {
          dismiss();
        }
      }}
    >
      <CommentComposer {...props} voice={voice} />
    </AppSheet>
  );
}

/** Heading, editor, the voice error, the accessory and the actions. */
function CommentComposer(
  props: Omit<CommentSheetProps, "voice"> & { readonly voice: LineCommentVoice },
): React.JSX.Element {
  const { drafts, target, voice } = props;
  const text = useSelector(() => drafts.read(target));
  const phase = phaseOf(voice.resource);
  const submit = useEvent((): void => {
    const line = target;
    const send = props.onSubmit;
    if (phase === "recording" || phase === "finishing") {
      // The transcript is the line's whole text; it is sent once transcribed.
      voice.finishAndSend((final) => {
        const body = final.trim();
        if (body.length > 0) {
          drafts.clear(line);
          send(body);
        }
      });
      props.onDismiss();
      return;
    }
    const body = commentBody(drafts.peek(line));
    if (body.length === 0) {
      return;
    }
    voice.release();
    drafts.clear(line);
    props.onDismiss();
    send(body);
  });
  return (
    <View style={styles.content} testID="review-comment-sheet">
      <Text accessibilityRole="header" style={styles.title}>
        {`Comment on line ${String(target.line)}`}
      </Text>
      <Text ellipsizeMode="middle" numberOfLines={1} style={styles.path}>
        {`${target.path} · ${target.side} side`}
      </Text>
      <CommentEditor drafts={drafts} target={target} text={text} voice={voice} />
      <VoiceError resource={voice.resource} />
      {props.accessory}
      <CommentActions
        canSend={phase === "recording" || phase === "finishing" || text.plainText.trim() !== ""}
        onSend={submit}
        submitLabel={props.submitLabel}
        voice={voice}
      />
    </View>
  );
}

/** The microphone (when dictation is available) and Send. */
function CommentActions({
  canSend,
  onSend,
  submitLabel,
  voice,
}: {
  readonly canSend: boolean;
  readonly onSend: () => void;
  readonly submitLabel: string;
  readonly voice: LineCommentVoice;
}): React.JSX.Element {
  return (
    <View style={styles.actions}>
      {voice.scope === null ? null : (
        <ComposerMicrophone
          disabled={false}
          finishVoice={voice.stop}
          microphoneAccess={voice.microphoneAccess}
          microphoneButtonRef={voice.microphoneButtonRef}
          retryVoice={voice.retry}
          toggleVoice={voice.toggle}
          voiceDisabled={voice.voiceDisabled}
          voicePhase={phaseOf(voice.resource)}
          voiceRetryAvailable={voice.resource?.retryAvailable ?? false}
        />
      )}
      <AppButton isDisabled={!canSend} onPress={onSend} testID="review-comment-send">
        {submitLabel}
      </AppButton>
    </View>
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
 * The Markdown editor, or the recording meter while the line is dictated. The
 * editor opens focused; a transcript lands in the line's retained text and
 * the editor shows it when it returns.
 */
function CommentEditor({
  drafts,
  target,
  text,
  voice,
}: {
  readonly drafts: LineCommentDrafts;
  readonly target: CommentSheetTarget;
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
      <View style={styles.editor}>
        <VoiceCaptureStatus
          backend={resource.backend}
          controller={voice.controller}
          phase={resource.phase}
          scope={scope}
          startedAt={resource.updatedAt}
        />
      </View>
    );
  }
  return (
    <View style={styles.editor}>
      <FocusedEditor
        onChange={change}
        onSelectionChange={voice.select}
        selection={resource?.pendingSelection ?? null}
        value={text.plainText}
      />
    </View>
  );
}

/** The editor, focused when it mounts so the sheet opens to type. */
function FocusedEditor({
  onChange,
  onSelectionChange,
  selection,
  value,
}: {
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
      style={styles.input}
      value={value}
      {...(selection === null ? {} : { selection })}
    />
  );
}

function phaseOf(resource: VoiceInputRow | null): VoiceInputRow["phase"] {
  return resource?.phase ?? "idle";
}

/** The Markdown when the editor has it, else the plain text; trimmed. */
function commentBody(text: LineCommentText): string {
  return (text.markdown.trim().length > 0 ? text.markdown : text.plainText).trim();
}
