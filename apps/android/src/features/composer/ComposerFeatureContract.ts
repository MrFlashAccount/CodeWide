import type { Personality } from "@codewide/codex-protocol/v0.155.1";
import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import type { Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import type { View } from "react-native";
import type { GetTransferAccess } from "../../data/private-transfer";
import type { StoredDraftAttachment } from "../../data/thread-ui-state-types";
import type { LoadTurnControls } from "../../data/turn-controls-types";
import type { DraftSelection } from "../../data/voice-draft";
import type { VoiceInputController } from "../../data/voice-input-controller";
import type {
  VoiceInputRow,
  WorkspaceResourceDatabase,
} from "../../data/workspace-resource-database";
import type { LargePasteEvent } from "../../native/large-paste";
import type { ActionMenuItem } from "../../ui/ActionMenu";
import type { GoalDialogProps } from "../goal/goalDialogContract";
import type {
  ComposerAccessoryAction,
  ComposerMenuPage,
  QueuedComposerEdit,
} from "./composerTypes";
import type { ComposerSendPreference } from "./deliveryMode";
import type { ComposerMarkdownInputHandle } from "./input/ComposerMarkdownInput.types";
import type { ComposerMention } from "./input/composer-mentions";
import type { ComposerTextSnapshot } from "./composerSession";

/** Capabilities and state required by the complete V1 composer surface. */
export type ComposerFeatureProps = {
  activatePrimaryAction: () => void;
  anchoredComposerActions: ActionMenuItem[];
  attachments: StoredDraftAttachment[];
  cancelQueuedComposerEdit: () => void;
  closeGoalAttachment: () => void;
  closeQuickControlMenu: (_scope: "model-menu" | "permissions-menu") => undefined;
  composerDiscardEnabled: boolean;
  composerInputRef: { current: ComposerMarkdownInputHandle | null };
  composerScope: string;
  composerTrayVisible: boolean;
  composerUploadScope: string;
  controlError: string | null;
  controlsResourceId: string | null;
  currentTurnId: string | null;
  cwd: string;
  deliveryActions: ActionMenuItem[];
  discardComposer: () => void;
  dismissComposerKeyboardForOverlay: () => void;
  draft: string;
  draftConnectionId: string | null;
  draftSelectionRef: { current: DraftSelection };
  draftThreadId: string | null;
  editingQueuedMessage: boolean;
  fileAttachmentEnabled: boolean;
  finishVoice: (sendAfter: boolean, preference?: ComposerSendPreference) => Promise<void>;
  getStableTransferAccess: GetTransferAccess;
  getTransferAccess: GetTransferAccess | undefined;
  goalAttachmentVisible: boolean;
  handleAnchoredComposerAction: (id: string) => void;
  handleComposerLargePaste: (event: LargePasteEvent) => void;
  handleComposerTextChange: (next: ComposerTextSnapshot) => void;
  handleDeliveryAction: (id: string) => void;
  microphoneAccess: { allowCapture: () => boolean; granted: boolean };
  microphoneButtonRef: RefObject<View | null>;
  newChat: boolean;
  onLoadControls: LoadTurnControls | undefined;
  onSetGoal: GoalDialogProps["onSet"] | undefined;
  openAccessoryAction: (action: ComposerAccessoryAction) => void;
  openControls: (initialPage: ComposerMenuPage) => void;
  openQuickControlMenu: (_scope: "model-menu" | "permissions-menu") => void;
  pastedAttachmentPending: boolean;
  pendingVoiceSelection: { end: number; start: number } | null;
  queuedComposerEdit: QueuedComposerEdit | null;
  queuedComposerEditBusy: boolean;
  queuedComposerEditError: string | null;
  readOnly: boolean;
  remoteThread: Thread | null | undefined;
  removeComposerAttachment: (attachmentId: string) => void;
  retryVoice: () => Promise<void>;
  searchComposerSuggestions: (query: {
    readonly indicator: "/" | "@";
    readonly text: string;
  }) => Promise<ComposerMention[]>;
  selectComposerMention: (mention: ComposerMention) => void;
  selectedEffort: string | null;
  selectedModel: string | null;
  selectedPermissions: string | null;
  selectedPersonality: Personality | null;
  selectedServiceTier: string | null | undefined;
  selectEffort: (effort: string) => void;
  selectModel: (model: string, effort: string) => void;
  selectPermissions: (permissions: string | null) => void;
  selectServiceTier: (serviceTier: string) => void;
  sendDisabled: boolean;
  setComposerTrayVisible: Dispatch<SetStateAction<boolean>>;
  setSelectedPersonality: (value: Personality | null) => void;
  steerComposer: () => void;
  stoppingResponse: boolean;
  terminalEnabled: boolean;
  threadLifecycleActive: boolean;
  toggleVoice: () => Promise<void>;
  toolContextChips: ReactNode;
  useAnchoredComposerMenu: boolean;
  voiceBackend: "android" | "remote";
  voiceController: VoiceInputController | null;
  voiceError: string | null;
  voicePhase: "idle" | "starting" | "recording" | "finishing";
  voiceResource: VoiceInputRow | null;
  voiceRetryAvailable: boolean;
  workspaceResources: WorkspaceResourceDatabase | null;
};
