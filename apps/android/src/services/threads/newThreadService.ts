import { observablePrimitive } from "@legendapp/state";
import { randomUUID } from "expo-crypto";
import type { NewChatWorkspaceMode } from "../../data/workspace-creation";

export type NewThreadDraft = {
  readonly connectionId: string;
  readonly cwd: string | null;
  readonly id: string;
  readonly workspaceMode: NewChatWorkspaceMode;
};

/** Owns the single V1 draft destination without serializing project paths into the URL. */
export class NewThreadService {
  readonly draft$ = observablePrimitive<NewThreadDraft | null>(null);

  open(connectionId: string, cwd: string | null): NewThreadDraft {
    const draft: NewThreadDraft = {
      connectionId,
      cwd,
      id: `new-chat-${randomUUID()}`,
      workspaceMode: "current",
    };
    this.draft$.set(draft);
    return draft;
  }

  /** Reopens the retained draft instead of replacing its composer and voice scope. */
  resumeOrOpen(connectionId: string, cwd: string | null): NewThreadDraft {
    return this.draft$.peek() ?? this.open(connectionId, cwd);
  }

  current(): NewThreadDraft | null {
    return this.draft$.peek();
  }

  changeProject(draftId: string, cwd: string | null): void {
    const draft = this.draft$.peek();
    if (draft === null || draft.id !== draftId) {
      return;
    }
    this.draft$.set({ ...draft, cwd, workspaceMode: "current" });
  }

  /** Changes an explicitly chosen destination while retaining the local draft identity. */
  changeDestination(
    expected: NewThreadDraft,
    destination: { readonly connectionId: string; readonly cwd: string | null },
  ): void {
    if (this.draft$.peek() !== expected) {
      return;
    }
    this.draft$.set({
      connectionId: destination.connectionId,
      cwd: destination.cwd,
      id: expected.id,
      workspaceMode: "current",
    });
  }

  changeWorkspaceMode(draftId: string, workspaceMode: NewChatWorkspaceMode): void {
    const draft = this.draft$.peek();
    if (draft === null || draft.id !== draftId) {
      return;
    }
    this.draft$.set({ ...draft, workspaceMode });
  }

  close(draftId: string): void {
    if (this.draft$.peek()?.id === draftId) {
      this.draft$.set(null);
    }
  }

  dispose(): void {
    this.draft$.set(null);
  }
}

/** Shared V1 draft destination owner retained across route changes. */
export const newThreadService = new NewThreadService();
