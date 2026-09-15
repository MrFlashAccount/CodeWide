import type {
  ReviewDelivery,
  ReviewTarget,
  ThreadGoal,
} from "@codewide/codex-protocol/v0.147.0/v2";
import type { QueuedPrompt } from "../../data/thread-delivery-state";
import type {
  VoiceTranscriptionEvent,
  VoiceTranscriptionOptions,
  VoiceTranscriptionSession,
} from "../../data/voice-input-controller";
import type {
  BackgroundTerminalValue,
  ThreadGoalInput,
  TunnelValue,
} from "../../data/workspace-resource-database";
/** Composition binds tool pages without giving the composer their controllers or models. */
export type ComposerToolCapabilities = {
  queuedPrompts: QueuedPrompt[];
  activeTurnId: string | null;
  onBeginQueuedEdit?(item: QueuedPrompt): void;
  onCancelQueued?(commandId: string): Promise<void>;
  onMoveQueued?(commandId: string, direction: -1 | 1): Promise<void>;
  onSteerQueued?(commandId: string, expectedTurnId: string): Promise<void>;
  onListTerminals?(): Promise<BackgroundTerminalValue[]>;
  onTerminateTerminal?(processId: string): Promise<boolean>;
  onSetGoal?(input: ThreadGoalInput): Promise<ThreadGoal>;
  onClearGoal?(): Promise<boolean>;
  onStartVoiceTranscription?(
    listener: (event: VoiceTranscriptionEvent) => void,
    options?: VoiceTranscriptionOptions,
  ): Promise<VoiceTranscriptionSession>;
  onStartReview?(target: ReviewTarget, delivery: ReviewDelivery): Promise<string>;
  onCreateTunnel?(port: number, ttlSeconds: number): Promise<TunnelValue>;
  onRevokeTunnel?(tunnelId: string): Promise<void>;
  backgroundTerminalsResourceId: string | null;
  goalResourceId: string | null;
  tunnelResourceId: string | null;
  portForwardingConnectionId: string | null;
  portForwardingServerName: string;
  onOpenPortForward?(title: string, url: string): void;
};
