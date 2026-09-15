import { expect, it } from "vitest";
import { ownerVoiceTransport, voiceController } from "./voice-runtime-sources";

it("preserves voice runtime integration contracts", () => {
  expect(ownerVoiceTransport).toContain('rpcAfterAttach(session, "companion/dictation/start", {');
  expect(voiceController).toContain("insertTranscriptAtSelection(source, selection, transcript)");
  expect(voiceController).toContain(
    "private sessionPromise: Promise<VoiceTranscriptionSession> | null",
  );
  expect(voiceController).toContain("sendAfter?.(finalDraft)");
  expect(voiceController).not.toContain("this.patch(binding.scope, { level: chunk.level })");
  expect(voiceController).not.toContain("setInterval(() => this.patch(binding.scope");
  expect(voiceController).toContain(
    'if (processBinding !== null || processState.phase !== "idle" || this.stopCapture !== null)',
  );
  expect(voiceController.indexOf("const capture = await startPcmCapture(")).toBeLessThan(
    voiceController.indexOf("const sessionPromise = startSession()"),
  );
  expect(voiceController).not.toContain("pendingAudio.shift()");
  expect(voiceController).toContain("pendingAudio.push(chunk)");
  expect(voiceController).toContain("pendingAudio.splice(0)");
  expect(voiceController).toContain("VOICE_SESSION_START_RETRIES = 3");
  expect(voiceController).toContain("deferredVoiceSession(startSession, pendingAudio)");
  expect(ownerVoiceTransport).toContain('rpcAfterAttach(session, "companion/dictation/start", {');
  expect(ownerVoiceTransport).toContain("captureSource: options.capture.source");
  expect(ownerVoiceTransport).toMatch(/sendDictationBatchUntilAccepted\(\s*session,\s*\{/u);
  expect(ownerVoiceTransport).toContain("batchId: String(batchId)");
  expect(ownerVoiceTransport).toContain(
    'rpcAfterAttach(session, "companion/dictation/finish", { sessionId })',
  );
  expect(ownerVoiceTransport).toContain(
    'rpcAfterAttach(session, "companion/dictation/cancel", { sessionId })',
  );
  expect(ownerVoiceTransport).toContain('listener({ type: "done", text })');
  expect(ownerVoiceTransport).toContain(
    "await raceAudioUploadAbort(uploader.finish(), cancellation.signal)",
  );
  expect(ownerVoiceTransport).toContain("RetryableVoiceTranscriptionError");
  expect(ownerVoiceTransport).toContain("DICTATION_FINISH_TRANSPORT_RETRIES = 3");
  expect(ownerVoiceTransport).toContain(
    "finishDictationWithTransportRetry(session, sessionId, cancellation.signal)",
  );
  expect(voiceController).toContain('phase: "recording", backend: "android"');
  expect(voiceController).toContain("private async startAndroidFallback");
});
