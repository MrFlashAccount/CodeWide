import { useRef } from "react";
import type { View } from "react-native";

import type { DraftSelection } from "../../../data/voice-draft";
import type { VoiceInputRow } from "../../../data/workspace-resource-database";
import { useEvent } from "../../../react/useEvent";
import { useAppDialog } from "../../../ui/AppDialog";
import { useMicrophoneAccess } from "../../../ui/use-microphone-access";
import { useVoiceInputDisabled } from "../../../ui/useVoiceInputDisabled";
import { useVoiceInputResource, type AppVoiceInputRuntime } from "../../../ui/VoiceInputRuntime";
import type { LineCommentDrafts } from "./lineCommentDrafts";
import { codeReviewVoiceInputScope, type CodeReviewLineReference } from "./reviewComment";

/** Dictation of one line composer over the retained app voice controller. */
export type LineCommentVoice = {
  readonly controller: AppVoiceInputRuntime["controller"];
  /** Stops the recording and hands the line's final text to `send` instead of the editor. */
  readonly finishAndSend: (send: (text: string) => void) => void;
  readonly microphoneAccess: { readonly allowCapture: () => boolean; readonly granted: boolean };
  readonly microphoneButtonRef: React.RefObject<View | null>;
  /** Ends this composer's claim when its sheet closes; a recording still lands on its line. */
  readonly release: () => void;
  readonly resource: VoiceInputRow | null;
  readonly retry: () => Promise<void>;
  readonly scope: string | null;
  /** Records the editor's selection, where a transcript is inserted. */
  readonly select: (selection: DraftSelection) => void;
  /** Stops the recording and inserts its transcript into the line. */
  readonly stop: () => Promise<void>;
  readonly toggle: () => Promise<void>;
  /** Another input holds the microphone and the hand-off policy forbids taking it. */
  readonly voiceDisabled: boolean;
};

/**
 * Binds the line composer to the retained VoiceInputController. The recording
 * scope is the review window plus the line, so reopening a line shows its own
 * recording or retry. The binding captures the line, never a latest-value
 * callback: a transcript that arrives after the sheet closed is written to that
 * line's retained text. No second recording runtime is created and nothing is
 * disposed on unmount.
 */
export function useLineCommentVoice({
  drafts,
  runtime,
  target,
}: {
  readonly drafts: LineCommentDrafts;
  readonly runtime: AppVoiceInputRuntime | null;
  readonly target: CodeReviewLineReference;
}): LineCommentVoice {
  const dialog = useAppDialog();
  const controller = runtime?.controller ?? null;
  const scope =
    runtime === null || controller === null
      ? null
      : codeReviewVoiceInputScope(runtime.scopePrefix, drafts.id, target);
  const resource = useVoiceInputResource(runtime, scope);
  const voiceDisabled = useVoiceInputDisabled(controller, scope);
  const microphoneAccess = useMicrophoneAccess();
  const microphoneButtonRef = useRef<View | null>(null);
  const selection = useRef<DraftSelection>({ end: 0, start: 0 });
  const pendingSelection = resource?.pendingSelection ?? null;
  const bind = (): boolean => {
    if (runtime === null || controller === null || scope === null) {
      return false;
    }
    const line = target;
    const writeLine = (text: string): void => {
      drafts.write(line, { markdown: text, plainText: text });
    };
    controller.bind({
      scope,
      selection: () => selection.current,
      send: writeLine,
      source: () => drafts.peek(line).plainText,
      thread: runtime.thread,
      updateDraft: writeLine,
      ...(runtime.startRemote === undefined ? {} : { startRemote: runtime.startRemote }),
    });
    return true;
  };
  const report = (error: unknown): void => {
    dialog.alert(
      "Voice input",
      error instanceof Error ? error.message : "The voice action did not complete.",
    );
  };
  const run = async (operation: (bound: string) => Promise<void>): Promise<void> => {
    if (scope === null) {
      return;
    }
    try {
      await operation(scope);
    } catch (error) {
      report(error);
    }
  };
  const toggle = useEvent(async (): Promise<void> => {
    if (!microphoneAccess.allowCapture() || !bind()) {
      return;
    }
    await run(async (bound) => {
      await controller?.toggle(bound);
    });
  });
  const retry = useEvent(async (): Promise<void> => {
    if (!bind()) {
      return;
    }
    await run(async (bound) => {
      await controller?.retry(bound);
    });
  });
  const stop = useEvent(async (): Promise<void> => {
    await run(async (bound) => {
      await controller?.finish(bound, false);
    });
  });
  const finishAndSend = useEvent((send: (text: string) => void): void => {
    if (scope !== null && controller !== null) {
      controller.finish(scope, true, send).catch(report);
    }
  });
  const release = useEvent((): void => {
    if (scope === null || controller === null) {
      return;
    }
    const phase = resource?.phase ?? "idle";
    if (phase === "recording" || phase === "starting") {
      controller.finish(scope, false).catch(report);
    } else if (phase === "idle") {
      controller.unbind(scope);
    }
  });
  const select = useEvent((next: DraftSelection): void => {
    selection.current = next;
    if (
      scope !== null &&
      pendingSelection !== null &&
      pendingSelection.start === next.start &&
      pendingSelection.end === next.end
    ) {
      controller?.clearPendingSelection(scope);
    }
  });
  return {
    controller,
    finishAndSend,
    microphoneAccess,
    microphoneButtonRef,
    release,
    resource,
    retry,
    scope,
    select,
    stop,
    toggle,
    voiceDisabled,
  };
}
