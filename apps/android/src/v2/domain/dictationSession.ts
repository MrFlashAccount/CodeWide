import type { SavedServerId } from "./ids";
import type { QualifiedThread } from "./qualifiedThread";
import type { VoiceInputScope } from "./voiceInputScope";

export interface DictationSession {
  audience: SavedServerId;
  id: string;
  scope: VoiceInputScope;
  state: "opening" | "recording" | "stopped" | "failed";
  thread: QualifiedThread | null;
}
