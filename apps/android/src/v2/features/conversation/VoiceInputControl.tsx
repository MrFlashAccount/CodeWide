import type { V2Projection } from "@codewide/sync-client/v2";
import { useRef, useState } from "react";

import { useEvent } from "../../../react/useEvent";
import type {
  VoiceSessionHandle,
  VoiceTransportEvent,
} from "../../application/ports/voiceTransport";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { SavedServerId } from "../../domain/ids";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import type { VoiceInputScope } from "../../domain/voiceInputScope";

export type VoiceInputState = "idle" | "starting" | "recording" | "finishing" | "retry" | "error";

export interface VoiceInputControlModel {
  activate(): Promise<void>;
  disabled: boolean;
  message: string | null;
  state: VoiceInputState;
}

interface UseVoiceInputControlInput {
  audience: SavedServerId;
  live: boolean;
  onTranscript(text: string): void;
  projection: V2Projection | null;
  scope: VoiceInputScope;
  thread: QualifiedThread | null;
}

/** Binds the composer microphone to one live authoritative V2 generation. */
export function useVoiceInputControl({
  audience,
  live,
  onTranscript,
  projection,
  scope,
  thread,
}: UseVoiceInputControlInput): VoiceInputControlModel {
  const runtime = useV2Runtime();
  const handle = useRef<VoiceSessionHandle | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [state, setState] = useState<VoiceInputState>("idle");
  const usable = live && projection !== null;

  const onEvent = useEvent((event: VoiceTransportEvent): void => {
    if (event.type === "recording") {
      setMessage("Listening…");
      setState("recording");
      return;
    }
    if (event.type === "result") {
      handle.current = null;
      onTranscript(event.text);
      setMessage(null);
      setState("idle");
      return;
    }
    if (event.type === "retry") {
      setMessage(`Voice is busy. Try again in ${Math.ceil(event.retryAfterMs / 1e3)} seconds.`);
      setState("retry");
      return;
    }
    handle.current = null;
    if (event.type === "cancelled") {
      setMessage(null);
      setState("idle");
      return;
    }
    setMessage("Voice input is unavailable. Try again.");
    setState("error");
  });
  const activate = useEvent(async (): Promise<void> => {
    if (state === "recording") {
      setState("finishing");
      await handle.current?.finish();
      return;
    }
    if (!usable || state === "starting" || state === "finishing" || handle.current !== null) return;
    setMessage(null);
    setState("starting");
    try {
      handle.current = await runtime.voice.start({
        audience,
        onEvent,
        scope,
        sourceGeneration: projection.sourceGeneration,
        thread,
      });
    } catch (cause) {
      handle.current = null;
      setMessage("Voice input is unavailable. Try again.");
      setState("error");
      throw cause;
    }
  });

  return {
    activate,
    disabled: !usable || state === "starting" || state === "finishing",
    message: usable ? message : "Voice input requires a live saved-server connection.",
    state,
  };
}
