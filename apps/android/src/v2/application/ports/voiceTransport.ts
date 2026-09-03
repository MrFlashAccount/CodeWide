import type { SavedServerId } from "../../domain/ids";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import type { VoiceInputScope } from "../../domain/voiceInputScope";
import type { V2U64 } from "@codewide/sync-client/v2";

export type VoiceTransportEvent =
  | { type: "recording" }
  | { level: number; type: "level" }
  | { text: string; type: "result" }
  | { retryAfterMs: number; type: "retry" }
  | { type: "cancelled" }
  | { type: "error" };

export interface VoiceSessionHandle {
  cancel(): Promise<void>;
  finish(): Promise<void>;
}

export interface VoiceTransportStartInput {
  audience: SavedServerId;
  onEvent(event: VoiceTransportEvent): void;
  scope: VoiceInputScope;
  signal: AbortSignal;
  sourceGeneration: V2U64;
  thread: QualifiedThread | null;
}

export interface VoiceTransport {
  start(input: VoiceTransportStartInput): Promise<VoiceSessionHandle>;
}
