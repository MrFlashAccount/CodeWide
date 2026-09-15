import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import type { GetTransferAccess, PrivateAssetSource } from "../../data/private-transfer";
import type { ThreadChangeDiffValue } from "../../data/thread-resource-types";
import type {
  ThreadChangeScope,
  ThreadResourcesValue,
} from "../../data/workspace-resource-database";
import type { CodeReviewComment } from "../../rendering/code-review";
import type { CodeReviewViewMode } from "../../rendering/code-review-bridge";
import type { AppVoiceInputRuntime } from "../../ui/VoiceInputRuntime";
import type { CodeReviewFileResource } from "./code-review-files";

/** Review resources, selection state, and commands required by the review workspace. */
export type CodeReviewWorkspaceProps = {
  changes: readonly CodeReviewFileResource[];
  changeScope?: ThreadChangeScope;
  changeScopes?: readonly ThreadChangeScope[];
  scopeLabel?: string;
  initialMode?: CodeReviewViewMode;
  initialWrapLines?: boolean;
  initialPath?: string;
  initialLine?: number;
  initialColumn?: number;
  cwd: string;
  thread: Thread | null;
  voiceRuntime: AppVoiceInputRuntime | null;
  getTransferAccess: GetTransferAccess;
  sourceOverrides?: Readonly<Record<string, string>>;
  /** Retain scoped/content identity; an attachment name is not a host filesystem path. */
  sourceAssets?: Readonly<Record<string, PrivateAssetSource>>;
  onLoadDiff?(path: string, scope?: ThreadChangeScope): Promise<ThreadChangeDiffValue>;
  onInitialLoad?(): Promise<ThreadResourcesValue>;
  onLoadScope?(scope: ThreadChangeScope): Promise<ThreadResourcesValue>;
  onPreferencesChange?(preferences: {
    scope: ThreadChangeScope;
    mode: CodeReviewViewMode;
    wrapLines: boolean;
  }): void;
  onDownload?(): void;
  onAttach(comments: readonly CodeReviewComment[]): Promise<boolean>;
  onClose(): void;
};
