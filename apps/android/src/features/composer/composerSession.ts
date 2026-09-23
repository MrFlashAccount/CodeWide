import type {
  StoredComposerPreferences,
  StoredDraftAttachment,
} from "../../data/thread-ui-state-types";
import { useSyncExternalStore } from "react";
import { useEvent } from "../../react/useEvent";
import { useConversationState } from "../../ui/use-conversation-scope";

/** Text representations emitted together by the resident composer editor. */
export type ComposerTextSnapshot = {
  readonly markdown: string;
  readonly plainText: string;
};

/** Complete live composer state for one normal-draft or queue-edit scope. */
export type ComposerSessionSnapshot = ComposerTextSnapshot & {
  readonly attachments: StoredDraftAttachment[];
  readonly preferences: StoredComposerPreferences;
};

type ProjectedComposerState = {
  readonly attachments: StoredDraftAttachment[];
  readonly plainText: string;
  readonly preferences: StoredComposerPreferences;
};

type ComposerSessionState = ComposerSessionSnapshot & {
  readonly projected: ProjectedComposerState;
};

class ComposerSessionModel {
  private state: ComposerSessionState;
  private readonly listeners = new Set<() => void>();

  constructor(projection: ProjectedComposerState) {
    this.state = createSession(projection);
  }

  readonly read = (): ComposerSessionSnapshot => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  reconcile(projection: ProjectedComposerState): void {
    this.state = reconcileSession(this.state, projection);
  }

  updateAttachments(attachments: StoredDraftAttachment[]): void {
    if (sameComposerAttachments(this.state.attachments, attachments)) {
      return;
    }
    this.state = { ...this.state, attachments };
    this.notifySubscribers();
  }

  updatePreferences(
    apply: (current: StoredComposerPreferences) => StoredComposerPreferences,
  ): void {
    const preferences = apply(this.state.preferences);
    if (sameComposerPreferences(this.state.preferences, preferences)) {
      return;
    }
    this.state = { ...this.state, preferences };
    this.notifySubscribers();
  }

  updateText(text: ComposerTextSnapshot): void {
    if (this.state.plainText === text.plainText && this.state.markdown === text.markdown) {
      return;
    }
    this.state = { ...this.state, ...text };
    this.notifySubscribers();
  }

  private notifySubscribers(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/** Mutation authority captured for one composer scope activation. */
export type ComposerSessionOwner = {
  read: () => ComposerSessionSnapshot;
  updateAttachments: (attachments: StoredDraftAttachment[]) => void;
  updatePreferences: (
    apply: (current: StoredComposerPreferences) => StoredComposerPreferences,
  ) => void;
  updateText: (text: ComposerTextSnapshot) => void;
};

/** Current UI binding plus an activation-safe owner capture. */
export type ComposerSessionBinding = ComposerSessionOwner & {
  capture: () => ComposerSessionOwner;
  readonly snapshot: ComposerSessionSnapshot;
};

/** Reconciles durable projections into the single live composer session. */
export function useComposerSession(
  scope: string,
  projection: ProjectedComposerState,
): ComposerSessionBinding {
  const [model] = useConversationState(scope, () => new ComposerSessionModel(projection));
  model.reconcile(projection);
  const snapshot = useSyncExternalStore(model.subscribe, model.read, model.read);
  const owner: ComposerSessionOwner = {
    read: model.read,
    updateAttachments: (attachments) => {
      model.updateAttachments(attachments);
    },
    updatePreferences: (apply) => {
      model.updatePreferences(apply);
    },
    updateText: (text) => {
      model.updateText(text);
    },
  };
  const read = useEvent(owner.read);
  const updateAttachments = useEvent(owner.updateAttachments);
  const updatePreferences = useEvent(owner.updatePreferences);
  const updateText = useEvent(owner.updateText);
  const capture = useEvent(() => owner);
  return {
    capture,
    read,
    snapshot,
    updateAttachments,
    updatePreferences,
    updateText,
  };
}

function createSession(projection: ProjectedComposerState): ComposerSessionState {
  return {
    ...projection,
    markdown: projection.plainText,
    projected: projection,
  };
}

function reconcileSession(
  current: ComposerSessionState,
  projection: ProjectedComposerState,
): ComposerSessionState {
  if (
    current.projected.plainText === projection.plainText &&
    sameComposerAttachments(current.projected.attachments, projection.attachments) &&
    sameComposerPreferences(current.projected.preferences, projection.preferences)
  ) {
    return current;
  }
  const acceptText = current.plainText === current.projected.plainText;
  const acceptAttachments = sameComposerAttachments(
    current.attachments,
    current.projected.attachments,
  );
  const acceptPreferences = sameComposerPreferences(
    current.preferences,
    current.projected.preferences,
  );
  const plainText = acceptText ? projection.plainText : current.plainText;
  const attachments = acceptAttachments ? projection.attachments : current.attachments;
  const preferences = acceptPreferences ? projection.preferences : current.preferences;
  return {
    attachments,
    markdown: acceptText ? projection.plainText : current.markdown,
    plainText,
    preferences,
    projected: projection,
  };
}

/** Compares persisted preference values without relying on projection identity. */
export function sameComposerPreferences(
  left: StoredComposerPreferences,
  right: StoredComposerPreferences,
): boolean {
  return (
    left.effort === right.effort &&
    left.model === right.model &&
    left.permissions === right.permissions &&
    left.personality === right.personality &&
    sameServiceTier(left, right) &&
    left.sendMode === right.sendMode &&
    sameStrings(left.skillPaths, right.skillPaths)
  );
}

function sameServiceTier(
  left: StoredComposerPreferences,
  right: StoredComposerPreferences,
): boolean {
  return left.serviceTier === right.serviceTier;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Compares durable attachment values without relying on SQLite projection identity. */
export function sameComposerAttachments(
  left: readonly StoredDraftAttachment[],
  right: readonly StoredDraftAttachment[],
): boolean {
  return (
    left.length === right.length &&
    left.every((attachment, index) => sameComposerAttachment(attachment, right[index]))
  );
}

function sameComposerAttachment(
  left: StoredDraftAttachment,
  right: StoredDraftAttachment | undefined,
): boolean {
  return (
    right !== undefined &&
    left.id === right.id &&
    left.kind === right.kind &&
    left.name === right.name &&
    left.path === right.path &&
    left.rootId === right.rootId &&
    sameAttachmentEditor(left.editor, right.editor) &&
    sameAttachmentPreview(left.preview, right.preview)
  );
}

function sameAttachmentEditor(
  left: StoredDraftAttachment["editor"],
  right: StoredDraftAttachment["editor"],
): boolean {
  return (
    left === right ||
    (left !== undefined && right !== undefined && left.revision === right.revision)
  );
}

function sameAttachmentPreview(
  left: StoredDraftAttachment["preview"],
  right: StoredDraftAttachment["preview"],
): boolean {
  return (
    left === right ||
    (left !== undefined &&
      right !== undefined &&
      left.bytes === right.bytes &&
      left.mimeType === right.mimeType &&
      left.text === right.text &&
      left.uri === right.uri)
  );
}
