import type { V2InputBlock } from "@codewide/sync-client/v2";
import { useRef, useState, useSyncExternalStore } from "react";

import { useEvent } from "../../../react/useEvent";
import type { CommandSettlement } from "../../application/commandCorrelation";
import type { ComposerAttachmentDraft } from "../../application/composer/composerAttachmentDraft";
import type { ComposerSubmission } from "../../application/composer/composerAttachmentTypes";
import type { ComposerAttachmentTarget } from "../../application/ports/composerAttachmentTransport";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { SavedServerId } from "../../domain/ids";
import type { WorkspaceModeSelection } from "./NewThreadWorkspaceMode";
import type { NewThreadSettingsSelection } from "./newThreadControls";
import {
  completedThreadId,
  newThreadTerminalMessage,
  prepareSubmissionWorkspace,
} from "./newThreadWorkspace";
import { actionFailure } from "./newThreadComposerActions";

interface UseNewThreadSubmissionInput {
  attachmentDraft: ComposerAttachmentDraft;
  onSucceeded(): void;
  onThreadCreated(threadId: string): void;
  savedServerId: SavedServerId;
  settings: NewThreadSettingsSelection;
  skillBlocks: readonly V2InputBlock[];
  workspace: string | null;
  workspaceMode: WorkspaceModeSelection;
}

interface NewThreadSubmissionModel {
  clearFailure(): void;
  error: string | null;
  locallyLocked: boolean;
  releaseUnsettled(): Promise<void>;
  retryBlocked: boolean;
  submit(submission: ComposerSubmission): Promise<boolean>;
  submitVoice(text: string): Promise<boolean>;
  submitting: boolean;
  unsettledCount: number;
}

interface LockedActivation {
  correlationId: string;
  operationId: string;
}

export function useNewThreadSubmission(
  input: UseNewThreadSubmissionInput,
): NewThreadSubmissionModel {
  const runtime = useV2Runtime();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const preparedWorkspace = useRef<{ key: string; workspace: string | null } | null>(null);
  const [lockedActivation, setLockedActivation] = useState<LockedActivation | null>(null);
  const [retryBlocked, setRetryBlocked] = useState(false);
  const settleTerminal = useEvent((frame: Parameters<typeof completedThreadId>[0]): boolean => {
    const createdThreadId = completedThreadId(frame);
    if (createdThreadId === null) {
      setRetryBlocked(true);
      setError(newThreadTerminalMessage(frame));
      return false;
    }
    input.onSucceeded();
    input.onThreadCreated(createdThreadId);
    return true;
  });
  const receiveSettlement = useEvent((settlement: CommandSettlement) => {
    if (
      lockedActivation === null ||
      settlement.correlationId !== lockedActivation.correlationId ||
      settlement.operationId !== lockedActivation.operationId
    ) {
      return;
    }
    setLockedActivation(null);
    if (settlement.kind === "notCreated") {
      setRetryBlocked(false);
      setError(settlement.failure.message);
      return;
    }
    if (settlement.kind === "terminal") settleTerminal(settlement.frame);
  });
  const [correlations] = useState(() =>
    runtime.commandCorrelations(
      { savedServerId: input.savedServerId, surface: "newThread", threadId: null },
      receiveSettlement,
    ),
  );
  const correlationSnapshot = useSyncExternalStore(
    correlations.subscribe,
    correlations.snapshot,
    correlations.snapshot,
  );
  const unsettledCorrelationIds = new Set(
    correlationSnapshot.value.map((value) => value.correlationId),
  );
  if (lockedActivation !== null) unsettledCorrelationIds.add(lockedActivation.correlationId);
  const locallyLocked = correlations.isScopeLocked();
  const releaseUnsettled = useEvent(async (): Promise<void> => {
    await correlations.releaseBlocking();
    setLockedActivation(null);
    setError(null);
  });

  const performSubmission = useEvent(
    async (
      prepareInput: (target: ComposerAttachmentTarget) => Promise<V2InputBlock[]>,
    ): Promise<boolean> => {
      const workspaceKey = submissionWorkspaceKey(input.workspace, input.workspaceMode);
      let resolvedWorkspace = preparedWorkspace.current;
      if (resolvedWorkspace?.key !== workspaceKey) {
        const prepared = await prepareSubmissionWorkspace({
          mode: input.workspaceMode,
          runtime,
          savedServerId: input.savedServerId,
          workspace: input.workspace,
        });
        if (prepared.kind === "error") {
          setError(prepared.message);
          return false;
        }
        resolvedWorkspace = { key: workspaceKey, workspace: prepared.workspace };
        preparedWorkspace.current = resolvedWorkspace;
      }
      if (resolvedWorkspace === null) {
        setError("Could not prepare the selected workspace.");
        return false;
      }
      const turnInput = await prepareInput({
        threadId: null,
        workspace: resolvedWorkspace.workspace,
      });
      for (const block of input.skillBlocks) turnInput.push(block);
      const settlement = await runtime.commands.executeCorrelated(
        { savedServerId: input.savedServerId, surface: "newThread", threadId: null },
        {
          input: turnInput,
          intent: "chat",
          kind: "turn.submit",
          settings: input.settings,
          threadId: null,
          workspace: resolvedWorkspace.workspace,
        },
      );
      if (settlement.kind === "notCreated") {
        setRetryBlocked(false);
        setError(settlement.failure.message);
        return false;
      }
      if (settlement.kind === "durableUnsettled") {
        correlations.retainLock(settlement);
        setLockedActivation({
          correlationId: settlement.correlationId,
          operationId: settlement.operationId,
        });
        setError(settlement.failure.message);
        return false;
      }
      return settleTerminal(settlement.frame);
    },
  );
  const submitPrepared = useEvent(
    (
      prepareInput: (target: ComposerAttachmentTarget) => Promise<V2InputBlock[]>,
    ): Promise<boolean> => {
      setError(null);
      setSubmitting(true);
      return performSubmission(prepareInput).then(
        (result) => {
          setSubmitting(false);
          return result;
        },
        (cause: unknown) => {
          setError(actionFailure(cause, "Action failed. Try again."));
          setSubmitting(false);
          return false;
        },
      );
    },
  );
  const submit = useEvent((submission: ComposerSubmission): Promise<boolean> =>
    submitPrepared(submission.prepareInput),
  );
  const submitVoice = useEvent((text: string): Promise<boolean> =>
    submitPrepared(async (target) => input.attachmentDraft.prepareInput(text, target)),
  );
  const clearFailure = useEvent(() => {
    setRetryBlocked(false);
    setError(null);
  });
  return {
    clearFailure,
    error,
    locallyLocked,
    releaseUnsettled,
    retryBlocked,
    submit,
    submitVoice,
    submitting,
    unsettledCount: unsettledCorrelationIds.size,
  };
}

function submissionWorkspaceKey(workspace: string | null, mode: WorkspaceModeSelection): string {
  return mode.kind === "current"
    ? `current\u0000${workspace ?? ""}`
    : `isolated\u0000${workspace ?? ""}\u0000${mode.support.provider}`;
}
