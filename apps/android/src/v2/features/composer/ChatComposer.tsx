import { useState, useSyncExternalStore, type ComponentType } from "react";

import {
  AUTO_ATTACH_PASTE_MIN_CHARS,
  captureLargePaste,
} from "../../application/composer/captureLargePaste";
import type { ComposerAttachmentDraft } from "../../application/composer/composerAttachmentDraft";
import type {
  ComposerAttachmentDraftSnapshot,
  LargePasteEvent,
} from "../../application/composer/composerAttachmentTypes";
import type { ResourceSnapshot } from "../../application/resources/resource";
import { ComposerView, type ComposerTextInputProps } from "../../presentation/input/ComposerView";
import { AsyncActionFeedbackView } from "../../presentation/actions/AsyncActionFeedbackView";
import type { ActionMenuItem } from "../../ui/ActionMenu";
import { useEvent } from "../../../react/useEvent";
import type { VoiceInputControlModel } from "../conversation/VoiceInputControl";
import type { QueueDeliveryMode } from "../../presentation/queue/queueTypes";
import { ComposerAttachmentTray } from "./ComposerAttachmentTray";
import {
  composerActionErrorMessage,
  composerMenuActions,
  optionalMenuActions,
  selectComposerMenu,
  voiceErrorMessage,
  voiceProps,
} from "./chatComposerPresentation";
import { useComposerInterruptAction } from "./useComposerInterruptAction";

export interface ChatComposerProps {
  activeTurnId?: string | null;
  attachmentDraft?: ComposerAttachmentDraft;
  disabled: boolean;
  deliveryActions?: readonly ActionMenuItem[];
  error?: string | null;
  InputComponent?: ComponentType<ComposerTextInputProps>;
  locked?: boolean;
  menuActions?: readonly ActionMenuItem[];
  onEdit?(): void;
  onEditAttachment?(item: ComposerAttachmentDraftSnapshot["items"][number]): void;
  onInterrupt?(turnId: string): Promise<void>;
  onSelectMenu?(id: string): void;
  onSubmit(text: string, deliveryMode?: QueueDeliveryMode): Promise<boolean>;
  onTextChange?(text: string): void;
  retryBlocked?: boolean;
  text?: string;
  voice?: VoiceInputControlModel;
  voiceLevel?: number;
  voiceNowMs?: number;
}

/** Owns composer-only UI state while leaving all conversation projection state authoritative. */
export function ChatComposer(props: ChatComposerProps): React.JSX.Element {
  const attachmentSnapshot = useSyncExternalStore(
    props.attachmentDraft?.subscribe ?? subscribeEmpty,
    props.attachmentDraft?.snapshot ?? emptyAttachmentSnapshot,
  );
  const [uncontrolledText, setUncontrolledText] = useState("");
  const [activationError, setActivationError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const text = props.text ?? uncontrolledText;
  const attachmentItems = attachmentSnapshot.value.items;
  const interruptEnabled =
    props.activeTurnId !== null &&
    props.activeTurnId !== undefined &&
    props.onInterrupt !== undefined &&
    (props.voice === undefined ||
      props.voice.captureState === "idle" ||
      props.voice.captureState === "error") &&
    text.trim() === "" &&
    attachmentItems.length === 0;
  const interrupt = useComposerInterruptAction({
    activeTurnId: props.activeTurnId,
    enabled: interruptEnabled,
    onInterrupt: props.onInterrupt,
  });
  const stopMode = interrupt.pending || interruptEnabled;
  const updateText = useEvent((value: string) => {
    setActivationError(null);
    interrupt.clearFailure();
    if (props.onTextChange === undefined) setUncontrolledText(value);
    else props.onTextChange(value);
    props.onEdit?.();
  });
  const submit = useEvent(async (deliveryMode?: QueueDeliveryMode) => {
    if (props.disabled || sending || interrupt.pending) return;
    if (interruptEnabled) {
      interrupt.activate();
      return;
    }
    if (props.locked === true || props.retryBlocked === true) return;
    if (props.voice?.state === "recording" || props.voice?.state === "retry") {
      setActivationError(null);
      setSending(true);
      await props.voice.submitTranscript().finally(() => setSending(false));
      return;
    }
    const value = text.trim();
    if (value === "" && attachmentSnapshot.value.items.length === 0) return;
    setSending(true);
    setActivationError(null);
    const submission =
      deliveryMode === undefined ? props.onSubmit(value) : props.onSubmit(value, deliveryMode);
    const completed = await submission.finally(() => setSending(false));
    if (!completed) return;
    updateText("");
    props.attachmentDraft?.commit();
  });
  const activateSubmit = useEvent(() => {
    submit().catch(() => setActivationError("Action failed. Try again."));
  });
  const selectDeliveryAction = useEvent((id: string) => {
    if (id !== "sendNow" && id !== "queue" && id !== "steer") return;
    submit(id).catch(() => setActivationError("Action failed. Try again."));
  });
  const selectMenu = useEvent((id: string) => {
    selectComposerMenu(props.attachmentDraft, props.onSelectMenu, id).catch((cause: unknown) =>
      setActivationError(composerActionErrorMessage(cause)),
    );
  });
  const handleLargePaste = useEvent((event: LargePasteEvent) => {
    const capture = captureLargePaste(text, event.text, event, AUTO_ATTACH_PASTE_MIN_CHARS);
    if (capture === null || props.attachmentDraft === undefined) return;
    const previousCount = attachmentSnapshot.value.items.length;
    updateText(capture.draftText);
    props.attachmentDraft.attachPastedText(capture.attachmentText).catch((cause: unknown) => {
      if (props.attachmentDraft?.snapshot().value.items.length === previousCount) {
        updateText(capture.pastedDraftText);
      }
      setActivationError(composerActionErrorMessage(cause));
    });
  });
  const items = attachmentItems;
  const draft = props.attachmentDraft;
  const removeAttachment = useEvent((id: string) => draft?.remove(id));
  const replaceAttachment = useEvent(async (id: string) => draft?.replace(id));
  const retryAttachment = useEvent(async (id: string) => draft?.retry(id));
  return (
    <>
      <ComposerView
        attachmentTray={
          draft === undefined ? null : (
            <ComposerAttachmentTray
              items={items}
              {...(props.onEditAttachment === undefined ? {} : { onEdit: props.onEditAttachment })}
              onRemove={removeAttachment}
              onReplace={replaceAttachment}
              onRetry={retryAttachment}
            />
          )
        }
        disabled={props.disabled || (props.locked === true && !stopMode)}
        {...(props.deliveryActions === undefined
          ? {}
          : {
              deliveryActions: props.deliveryActions,
              onSelectDeliveryAction: selectDeliveryAction,
            })}
        error={props.error ?? voiceErrorMessage(props.voice) ?? activationError}
        hasAttachments={items.length > 0}
        {...(props.InputComponent === undefined ? {} : { InputComponent: props.InputComponent })}
        largePasteThreshold={AUTO_ATTACH_PASTE_MIN_CHARS}
        {...optionalMenuActions(composerMenuActions(props.menuActions, draft !== undefined))}
        onChangeText={updateText}
        onLargePaste={handleLargePaste}
        onSelectMenu={selectMenu}
        onSubmit={activateSubmit}
        {...voiceProps(props.voice, props.voiceLevel ?? 0, props.voiceNowMs)}
        pending={sending || interrupt.pending}
        primaryAction={stopMode ? "stop" : "send"}
        retryBlocked={!stopMode && props.retryBlocked === true}
        text={text}
      />
      <AsyncActionFeedbackView
        error={interruptEnabled ? interrupt.error : null}
        onRetry={interrupt.retry}
        pending={false}
        pendingLabel="Stopping response…"
        testID="composer-interrupt-feedback"
      />
    </>
  );
}

const EMPTY_VALUE: ComposerAttachmentDraftSnapshot = { items: [] };
const EMPTY_SNAPSHOT: ResourceSnapshot<ComposerAttachmentDraftSnapshot> = {
  status: "ready",
  value: EMPTY_VALUE,
};
const emptyAttachmentSnapshot = () => EMPTY_SNAPSHOT;
const subscribeEmpty = () => () => undefined;
