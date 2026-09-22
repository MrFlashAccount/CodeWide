import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import type { GetTransferAccess, PrivateAssetSource } from "../../../data/private-transfer";
import type { ThreadChangeDiffValue } from "../../../data/thread-resource-types";
import type {
  ThreadChangeScope,
  ThreadResourcesValue,
} from "../../../data/workspace-resource-database";
import type { CodeReviewComment } from "../comments/reviewComment";
import type { CodeReviewViewMode } from "../editor/editorBridge";
import type { AppVoiceInputRuntime } from "../../../ui/VoiceInputRuntime";
import type { CodeReviewFileResource } from "../resources/reviewFiles";

/** Review resources, selection state, and commands required by the review workspace. */
export type CodeReviewWorkspaceProps = {
  changes: readonly CodeReviewFileResource[];
  changeScope?: ThreadChangeScope;
  changeScopes?: readonly ThreadChangeScope[];
  cwd: string;
  getTransferAccess: GetTransferAccess;
  initialColumn?: number;
  initialLine?: number;
  initialMode?: CodeReviewViewMode;
  initialPath?: string;
  initialWrapLines?: boolean;
  onAttach: (comments: readonly CodeReviewComment[]) => Promise<boolean>;
  onClose: () => void;
  onDownload?: () => void;
  onInitialLoad?: () => Promise<ThreadResourcesValue>;
  onLoadDiff?: (path: string, scope?: ThreadChangeScope) => Promise<ThreadChangeDiffValue>;
  onLoadScope?: (scope: ThreadChangeScope) => Promise<ThreadResourcesValue>;
  onPreferencesChange?: (preferences: {
    mode: CodeReviewViewMode;
    scope: ThreadChangeScope;
    wrapLines: boolean;
  }) => void;
  scopeLabel?: string;
  /** Retain scoped/content identity; an attachment name is not a host filesystem path. */
  sourceAssets?: Readonly<Record<string, PrivateAssetSource>>;
  sourceOverrides?: Readonly<Record<string, string>>;
  thread: Thread | null;
  voiceRuntime: AppVoiceInputRuntime | null;
};
