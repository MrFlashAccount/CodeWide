import { useRef, useState } from "react";
import {
  VoiceCaptureControls,
  type VoiceCaptureState,
} from "../../../presentation/voice/VoiceCaptureControls";

import type {
  VoiceTransportEvent,
  VoiceSessionHandle,
} from "../../application/ports/voiceTransport";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { V2Projection } from "@codewide/sync-client/v2";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { useEvent } from "../../../react/useEvent";

interface VoiceInputControlProps {
  live: boolean;
  onTranscript(text: string): void;
  owner: QualifiedThread;
  projection: V2Projection | null;
}

/** Binds shared Voice presentation to a live, authoritative V2 conversation generation. */
export function VoiceInputControl({
  live,
  onTranscript,
  owner,
  projection,
}: VoiceInputControlProps): React.JSX.Element {
  const runtime = useV2Runtime();
  const handle = useRef<VoiceSessionHandle | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [state, setState] = useState<VoiceCaptureState>("idle");
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
      setMessage("Voice transcript added to the message.");
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
      setMessage("Voice input cancelled.");
      setState("idle");
      return;
    }
    setMessage("Voice input is unavailable. Try again.");
    setState("error");
  });
  const cancel = useEvent(async () => {
    setState("finishing");
    await handle.current?.cancel();
  });
  const fail = useEvent(() => {
    handle.current = null;
    setMessage("Voice input is unavailable. Try again.");
    setState("error");
  });
  const finish = useEvent(async () => {
    setState("finishing");
    await handle.current?.finish();
  });
  const start = useEvent(async () => {
    if (projection === null || !live || handle.current !== null) return;
    setMessage(null);
    setState("starting");
    const started = await runtime.voice.start({
      audience: owner.savedServerId,
      onEvent,
      scope: { id: owner.threadId, kind: "composer" },
      sourceGeneration: projection.sourceGeneration,
      thread: owner,
    });
    handle.current = started;
  });

  return (
    <VoiceCaptureControls
      disabled={!usable || state === "starting"}
      message={usable ? message : "Voice input requires a live saved-server connection."}
      onCancel={cancel}
      onFailure={fail}
      onFinish={finish}
      onStart={start}
      state={state}
    />
  );
}
