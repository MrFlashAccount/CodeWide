import type { SyncEvent } from "@codewide/sync-client";
import { describe, expect, it } from "vitest";

import { globalSupervisorQualifiedChatRef } from "../src/data/globalSupervisorBinding";
import { createGlobalSupervisorSpeechState } from "../src/data/globalSupervisorSpeechState";
import { createGlobalSupervisorRenderModel } from "../src/features/globalSupervisor/globalSupervisorRenderModel";
import { globalVoiceOrbStateForPhase } from "../src/features/globalSupervisor/globalVoiceOrbState";
import { globalVoiceWebRtcUserSpeaking } from "../src/native/globalVoiceWebRtcSpeechEvent";

function fixture() {
  let time = 0;
  const home = globalSupervisorQualifiedChatRef("home", "hidden");
  const model = createGlobalSupervisorRenderModel();
  const states: string[] = [];
  model.publishStarting(home);
  model.render$.onChange(({ value }) => states.push(globalVoiceOrbStateForPhase(value.phase)));
  const speech = createGlobalSupervisorSpeechState({
    home,
    now: () => time,
    publish: (event) => model.publishRuntimeEvent({ activationId: "activation", event }),
  });
  return {
    advance: (ms: number) => { time += ms; },
    model,
    speech,
    states,
  };
}

function turn(method: string, id = "turn", threadId = "hidden"): SyncEvent {
  return { cursor: "1", payload: { method, params: { threadId, turn: { id } } } };
}

describe("Global Voice authoritative speech projection", () => {
  it("projects listening -> thinking -> speaking -> listening through the real render model", () => {
    const { speech, advance, states } = fixture();
    speech.start();
    speech.setUserSpeaking(true);
    speech.acceptTranscript("user", false);
    speech.setUserSpeaking(false);
    speech.acceptTranscript("user", true);
    speech.acceptThreadEvents("home", [turn("turn/started")]);
    speech.setPlaybackLevel(0.08);
    // Neither text completion nor a turn completion is a playback-drained event.
    speech.acceptTranscript("assistant", true);
    speech.acceptThreadEvents("home", [turn("turn/completed")]);
    advance(100);
    speech.setPlaybackLevel(0);
    expect(states).toEqual(["listening", "thinking", "speaking"]);
    advance(400);
    speech.setPlaybackLevel(0);
    expect(states).toEqual(["listening", "thinking", "speaking", "listening"]);
  });

  it("admits playback without itemAdded and holds speaking through short silence", () => {
    const { speech, advance, states } = fixture();
    speech.start();
    speech.setPlaybackLevel(0.02);
    speech.acceptTranscript("assistant", true);
    for (let i = 0; i < 4; i += 1) {
      advance(100);
      speech.setPlaybackLevel(0);
    }
    expect(states).toEqual(["listening", "speaking"]);
    speech.setPlaybackLevel(0.01);
    advance(300);
    speech.setPlaybackLevel(0);
    expect(states).toEqual(["listening", "speaking"]);
    advance(200);
    speech.setPlaybackLevel(0);
    expect(states.at(-1)).toBe("listening");
  });

  it("uses exact qualified home activity, ignores unrelated and stale completions, resumes thinking after playback", () => {
    const { speech, advance, states } = fixture();
    speech.start();
    speech.acceptThreadEvents("other", [turn("turn/started")]);
    speech.acceptThreadEvents("home", [turn("turn/started", "turn", "visible")]);
    speech.acceptItem({ role: "system", type: "message" });
    expect(states).toEqual(["listening"]);
    speech.acceptThreadEvents("home", [turn("turn/started", "current")]);
    speech.acceptThreadEvents("home", [turn("turn/completed", "older")]);
    speech.setPlaybackLevel(0.5);
    advance(500);
    speech.setPlaybackLevel(0);
    expect(states).toEqual(["listening", "thinking", "speaking", "thinking"]);
    speech.acceptThreadEvents("home", [turn("turn/completed", "current")]);
    expect(states.at(-1)).toBe("listening");
  });

  it("gives confirmed user barge-in priority and does not let late transcript completion erase activity", () => {
    const { speech, states } = fixture();
    speech.start();
    speech.acceptThreadEvents("home", [turn("turn/started")]);
    speech.setPlaybackLevel(0.3);
    speech.setUserSpeaking(true);
    speech.setPlaybackLevel(0.1);
    speech.acceptTranscript("assistant", true);
    expect(states.at(-1)).toBe("listening");
    speech.setUserSpeaking(false);
    speech.acceptTranscript("user", false);
    expect(states.at(-1)).toBe("speaking");
  });

  it("fences startup and stopped transports from connecting/error/disabled/idle", () => {
    const { speech, model, states } = fixture();
    speech.setPlaybackLevel(0.7);
    expect(globalVoiceOrbStateForPhase(model.render$.peek().phase)).toBe("connecting");
    speech.start();
    speech.stop();
    model.publishStopping(globalSupervisorQualifiedChatRef("home", "hidden"));
    speech.setPlaybackLevel(1);
    speech.acceptTranscript("user", false);
    speech.acceptThreadEvents("home", [turn("turn/started")]);
    expect(states.at(-1)).toBe("disabled");
    model.fail("realtimeFailed", { action: "reconnectHome", label: "Reconnect" });
    speech.setUserSpeaking(true);
    expect(states.at(-1)).toBe("error");
    model.publishReady(globalSupervisorQualifiedChatRef("home", "hidden"));
    expect(states.at(-1)).toBe("idle");
  });

  it("validates VAD messages without treating transcription, response or arbitrary payloads as audio", () => {
    expect(globalVoiceWebRtcUserSpeaking('{"type":"input_audio_buffer.speech_started"}')).toBe(true);
    expect(globalVoiceWebRtcUserSpeaking('{"type":"input_audio_buffer.speech_stopped"}')).toBe(false);
    for (const data of [null, 12, {}, "invalid", "null", '{"type":"response.done"}', '{"type":"conversation.item.added"}']) {
      expect(globalVoiceWebRtcUserSpeaking(data)).toBeNull();
    }
  });
});
