import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";

import type { V2Projection } from "@codewide/sync-client/v2";
import { useEvent } from "../src/react/useEvent";
import { V2RuntimeProvider } from "../src/v2/application/react/V2RuntimeContext";
import type { VoiceTransportStartInput } from "../src/v2/application/ports/voiceTransport";
import { ObservableResource } from "../src/v2/application/resources/resource";
import type { V2Runtime } from "../src/v2/application/v2Runtime";
import {
  VoiceInputController,
  voiceInputScopeKey,
} from "../src/v2/application/voiceInputController";
import { insertVoiceTranscript } from "../src/v2/application/voiceTranscriptInsertion";
import { savedServerId, threadId } from "../src/v2/domain/ids";
import { ChatComposer } from "../src/v2/features/composer/ChatComposer";
import {
  useVoiceInputControl,
  useVoiceInputLevel,
} from "../src/v2/features/conversation/VoiceInputControl";
import { VoiceTextInput } from "../src/v2/features/conversation/VoiceTextInput";
import { ComposerView } from "../src/v2/presentation/input/ComposerView";
import { VoiceTextInputView } from "../src/v2/presentation/input/VoiceTextInputView";
import { VoiceCaptureControls } from "../src/v2/presentation/voice/VoiceCaptureControls";

describe("V2 voice composer", () => {
  it("releases the compiled composer voice action after a rejected activation", async () => {
    const onVoice = jest.fn(async () => {
      throw new Error("Microphone unavailable");
    });
    render(
      <ComposerView
        disabled={false}
        onChangeText={jest.fn()}
        onSubmit={jest.fn()}
        onVoice={onVoice}
        pending={false}
        retryBlocked={false}
        text=""
      />,
    );

    await act(async () => {
      fireEvent.press(screen.getByLabelText("Voice input"));
    });
    expect(screen.getByLabelText("Voice input").props.accessibilityState.busy).toBe(false);

    await act(async () => {
      fireEvent.press(screen.getByLabelText("Voice input"));
    });
    expect(onVoice).toHaveBeenCalledTimes(2);
  });

  it("preserves frozen V1 voice labels, meter, retry, error, and send semantics", () => {
    const common = {
      disabled: false,
      onChangeText: jest.fn(),
      onSubmit: jest.fn(),
      onVoice: jest.fn(async () => undefined),
      onVoiceCancel: jest.fn(async () => undefined),
      pending: false,
      retryBlocked: false,
      text: "",
    };
    const rendered = render(<ComposerView {...common} voiceState="starting" />);

    expect(screen.getByLabelText("Voice recording")).toBeTruthy();
    expect(screen.getByText("Connecting…")).toBeTruthy();
    expect(screen.getByText("•••")).toBeTruthy();
    expect(screen.getByLabelText("Stop voice input and insert transcript")).toBeTruthy();
    expect(screen.getByLabelText("Cancel voice input")).toBeTruthy();
    expect(screen.getByLabelText("Finish voice input and send transcript")).toBeTruthy();
    expect(screen.queryByLabelText("Message Codex")).toBeNull();

    rendered.rerender(
      <ComposerView
        {...common}
        voiceElapsedSeconds={65}
        voiceLevel={0.42}
        voiceState="recording"
      />,
    );
    expect(screen.getByText("1:05")).toBeTruthy();
    expect(screen.getAllByTestId("v2-voice-meter-bar")).toHaveLength(5);
    expect(
      screen.getByLabelText("Finish voice input and send transcript").props.accessibilityState
        .disabled,
    ).toBe(false);

    rendered.rerender(<ComposerView {...common} voiceState="finishing" />);
    expect(screen.getByText("Transcribing…")).toBeTruthy();
    expect(screen.getByText("⌛")).toBeTruthy();
    expect(
      screen.getByLabelText("Stop voice input and insert transcript").props.accessibilityState
        .disabled,
    ).toBe(true);
    expect(
      screen.getByLabelText("Finish voice input and send transcript").props.accessibilityState
        .disabled,
    ).toBe(true);

    rendered.rerender(
      <ComposerView
        {...common}
        voiceMessage="Voice is busy. Try again in 1 seconds."
        voiceState="retry"
      />,
    );
    expect(screen.queryByText("Transcribing…")).toBeNull();
    expect(screen.getAllByText("Voice is busy. Try again in 1 seconds.")).toHaveLength(2);
    expect(
      screen.getByLabelText("Retry voice transcription").props.accessibilityState.disabled,
    ).toBe(false);
    expect(
      screen.getByLabelText("Finish voice input and send transcript").props.accessibilityState
        .disabled,
    ).toBe(true);

    rendered.rerender(
      <ComposerView
        {...common}
        voiceMessage="Voice input is unavailable. Try again."
        voiceState="error"
      />,
    );
    expect(screen.getByLabelText("Message Codex")).toBeTruthy();
    expect(screen.getByText("Voice input is unavailable. Try again.")).toBeTruthy();
    expect(screen.getByLabelText("Voice input")).toBeTruthy();
    expect(screen.getByLabelText("Send message")).toBeTruthy();
    expect(screen.queryByLabelText("Voice recording")).toBeNull();
  });

  it("exposes a stable cancel action and visible cancelling state in the active composer", async () => {
    const onVoiceCancel = jest.fn(async () => undefined);
    const common = {
      disabled: false,
      onChangeText: jest.fn(),
      onSubmit: jest.fn(),
      onVoice: jest.fn(async () => undefined),
      onVoiceCancel,
      pending: false,
      retryBlocked: false,
      text: "",
    };
    const rendered = render(<ComposerView {...common} voiceState="recording" />);

    await act(async () => fireEvent.press(screen.getByLabelText("Cancel voice input")));
    expect(onVoiceCancel).toHaveBeenCalledTimes(1);

    rendered.rerender(
      <ComposerView
        {...common}
        voiceCancelDisabled
        voiceMessage="Cancelling voice…"
        voiceState="cancelling"
      />,
    );
    expect(screen.getByText("Cancelling voice…")).toBeTruthy();
    expect(screen.getByLabelText("Cancel voice input").props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });
  });

  it("wires the stable cancel action through the production chat composer", async () => {
    const cancel = jest.fn(async () => undefined);
    const voice = {
      activate: jest.fn(async () => undefined),
      cancel,
      captureState: "recording" as const,
      disabled: false,
      finishTranscript: jest.fn(async () => undefined),
      message: "Listening…",
      retry: jest.fn(async () => undefined),
      startedAtMs: 0,
      state: "recording" as const,
      submitTranscript: jest.fn(async () => undefined),
    };
    const rendered = render(
      <ChatComposer
        disabled={false}
        onSubmit={jest.fn(async () => true)}
        voice={voice}
        voiceLevel={0.4}
        voiceNowMs={1000}
      />,
    );

    await act(async () => fireEvent.press(screen.getByLabelText("Cancel voice input")));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByText("0:01")).toBeTruthy();

    rendered.rerender(
      <ChatComposer
        disabled={false}
        onSubmit={jest.fn(async () => true)}
        voice={{
          ...voice,
          captureState: "error",
          message: "OpenAI transcription: Microphone permission was denied",
          state: "error",
        }}
      />,
    );
    expect(screen.getByText("OpenAI transcription: Microphone permission was denied")).toBeTruthy();
  });

  it("settles rejected voice controls and exposes another attempt", async () => {
    const onFailure = jest.fn();
    const onStart = jest.fn(async () => {
      throw new Error("Microphone unavailable");
    });
    render(
      <VoiceCaptureControls
        disabled={false}
        level={0}
        message={null}
        onCancel={jest.fn(async () => undefined)}
        onFailure={onFailure}
        onFinish={jest.fn(async () => undefined)}
        onRetry={jest.fn(async () => undefined)}
        onStart={onStart}
        state="idle"
      />,
    );

    await act(async () => {
      fireEvent.press(screen.getByLabelText("Start voice input"));
    });
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Start voice input").props.accessibilityState.busy).toBe(false);

    await act(async () => {
      fireEvent.press(screen.getByLabelText("Start voice input"));
    });
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it("keeps the frozen V1 inline-input voice affordance for progress and retry", () => {
    const activate = jest.fn(async () => undefined);
    const rendered = render(
      <VoiceTextInputView
        onChangeText={jest.fn()}
        value="draft"
        voice={{ activate, disabled: false, state: "starting" }}
      />,
    );

    expect(screen.getByText("•••")).toBeTruthy();
    expect(screen.getByLabelText("Stop voice input")).toBeTruthy();

    rendered.rerender(
      <VoiceTextInputView
        onChangeText={jest.fn()}
        value="draft"
        voice={{ activate, disabled: false, state: "retry" }}
      />,
    );
    expect(screen.getByLabelText("Retry voice input")).toBeTruthy();
    expect(screen.queryByText("•••")).toBeNull();

    rendered.rerender(
      <VoiceTextInputView
        onChangeText={jest.fn()}
        value="draft"
        voice={{ activate, disabled: false, state: "error" }}
      />,
    );
    expect(screen.getByLabelText("Voice input")).toBeTruthy();
  });

  it("inserts a transcript at the latest normalized selection", () => {
    expect(insertVoiceTranscript("alpha beta", { end: 10, start: 6 }, " gamma ")).toEqual({
      cursor: 11,
      text: "alpha gamma",
    });
    expect(insertVoiceTranscript("alphabeta", { end: 500, start: 5 }, "spoken")).toEqual({
      cursor: 12,
      text: "alpha spoken",
    });
  });

  it("delivers a field transcript after another route stops the process-owned recording", async () => {
    let startInput: VoiceTransportStartInput | null = null;
    const finish = jest.fn(async () => {
      startInput?.onEvent({ text: "spoken words", type: "result" });
    });
    const controller = new VoiceInputController({
      start: async (input) => {
        startInput = input;
        input.onEvent({ type: "recording" });
        return { cancel: async () => undefined, finish };
      },
    });
    const projection = new ObservableResource({
      operations: [],
      projections: { live: { sourceGeneration: "1" }, retained: null },
      state: "live" as const,
      version: 1,
    });
    // WHY: Constructing the production runtime would start platform services unavailable in Jest.
    const runtime = {
      sessions: { resource: () => projection },
      voice: controller,
    } as unknown as V2Runtime;
    const insertOriginal = jest.fn();
    const insertOther = jest.fn();
    const rendered = render(
      <V2RuntimeProvider runtime={runtime}>
        <VoiceTextInput
          key="route-a"
          audience={savedServerId("server-a")}
          onChangeText={insertOriginal}
          scope={{ id: "route-a-title", kind: "generic" }}
          thread={null}
          value="alpha"
        />
      </V2RuntimeProvider>,
    );

    await act(async () => fireEvent.press(screen.getByLabelText("Voice input")));
    rendered.rerender(
      <V2RuntimeProvider runtime={runtime}>
        <VoiceTextInput
          key="route-b"
          audience={savedServerId("server-a")}
          onChangeText={insertOther}
          scope={{ id: "route-b-filter", kind: "generic" }}
          thread={null}
          value="other"
        />
      </V2RuntimeProvider>,
    );
    await act(async () => fireEvent.press(screen.getByLabelText("Stop voice input")));

    expect(finish).toHaveBeenCalledTimes(1);
    expect(insertOriginal).not.toHaveBeenCalled();
    expect(insertOther).not.toHaveBeenCalled();
    rendered.rerender(
      <V2RuntimeProvider runtime={runtime}>
        <VoiceTextInput
          key="route-a-returned"
          audience={savedServerId("server-a")}
          onChangeText={insertOriginal}
          scope={{ id: "route-a-title", kind: "generic" }}
          thread={null}
          value="alpha"
        />
      </V2RuntimeProvider>,
    );
    expect(insertOriginal).toHaveBeenCalledWith("alpha spoken words");
    expect(insertOther).not.toHaveBeenCalled();
  });

  it("renders live level, finish, cancel, and retry presentation states", () => {
    const actions = {
      cancel: jest.fn(async () => undefined),
      failure: jest.fn(),
      finish: jest.fn(async () => undefined),
      retry: jest.fn(async () => undefined),
      start: jest.fn(async () => undefined),
    };
    const rendered = render(
      <VoiceCaptureControls
        disabled={false}
        level={0.42}
        message="Listening…"
        onCancel={actions.cancel}
        onFailure={actions.failure}
        onFinish={actions.finish}
        onRetry={actions.retry}
        onStart={actions.start}
        state="recording"
      />,
    );

    expect(screen.getByLabelText("Voice input level").props.accessibilityValue.now).toBe(42);
    expect(screen.getByLabelText("Finish voice input")).toBeTruthy();
    expect(screen.getByLabelText("Cancel voice input")).toBeTruthy();

    rendered.rerender(
      <VoiceCaptureControls
        disabled={false}
        level={0}
        message="Voice is busy. Try again."
        onCancel={actions.cancel}
        onFailure={actions.failure}
        onFinish={actions.finish}
        onRetry={actions.retry}
        onStart={actions.start}
        state="retry"
      />,
    );
    expect(screen.getByLabelText("Retry voice transcription")).toBeTruthy();
    expect(screen.getByLabelText("Cancel voice input")).toBeTruthy();
  });

  it("submits the authoritative transcript instead of inserting a local draft", async () => {
    let startInput: VoiceTransportStartInput | null = null;
    const finish = jest.fn(async () => {
      startInput?.onEvent({ text: "spoken message", type: "result" });
    });
    const controller = new VoiceInputController({
      start: async (input: VoiceTransportStartInput) => {
        startInput = input;
        input.onEvent({ type: "recording" });
        return { cancel: async () => undefined, finish };
      },
    });
    // WHY: Constructing the production runtime would start platform services unavailable in Jest.
    const runtime = { voice: controller } as V2Runtime;
    const onInsert = jest.fn();
    const onSubmit = jest.fn(async () => true);
    render(
      <V2RuntimeProvider runtime={runtime}>
        <VoiceControlHarness onInsert={onInsert} onSubmit={onSubmit} />
      </V2RuntimeProvider>,
    );

    await act(async () => fireEvent.press(screen.getByLabelText("Start voice")));
    expect(screen.getByText("recording")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByLabelText("Submit voice")));

    expect(finish).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("spoken message");
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("restores the transcript to the draft when authoritative submission fails", async () => {
    let startInput: VoiceTransportStartInput | null = null;
    const finish = jest.fn(async () => {
      startInput?.onEvent({ text: "preserve this transcript", type: "result" });
    });
    const controller = new VoiceInputController({
      start: async (input: VoiceTransportStartInput) => {
        startInput = input;
        input.onEvent({ type: "recording" });
        return { cancel: async () => undefined, finish };
      },
    });
    // WHY: This isolates the result-to-submit handoff without opening platform services in Jest.
    const runtime = { voice: controller } as V2Runtime;
    const onInsert = jest.fn();
    const onSubmit = jest.fn(async () => false);
    render(
      <V2RuntimeProvider runtime={runtime}>
        <VoiceControlHarness onInsert={onInsert} onSubmit={onSubmit} />
      </V2RuntimeProvider>,
    );

    await act(async () => fireEvent.press(screen.getByLabelText("Start voice")));
    await act(async () => fireEvent.press(screen.getByLabelText("Submit voice")));

    expect(onSubmit).toHaveBeenCalledWith("preserve this transcript");
    expect(onInsert).toHaveBeenCalledWith("preserve this transcript");
    expect(screen.getByText("error")).toBeTruthy();
  });

  it("keeps global recording operable across chats and submits to the original chat", async () => {
    let startInput: VoiceTransportStartInput | null = null;
    const cancel = jest.fn(async () => undefined);
    const finish = jest.fn(async () => {
      startInput?.onEvent({ text: "message for the original chat", type: "result" });
    });
    const start = jest.fn(async (input: VoiceTransportStartInput) => {
      startInput = input;
      input.onEvent({ type: "recording" });
      return { cancel, finish };
    });
    const controller = new VoiceInputController({
      start,
    });
    const runtime = { voice: controller } as V2Runtime;
    const insertOriginal = jest.fn();
    const submitOriginal = jest.fn(async () => true);
    const insertOther = jest.fn();
    const submitOther = jest.fn(async () => true);
    const rendered = render(
      <V2RuntimeProvider runtime={runtime}>
        <VoiceControlHarness
          onInsert={insertOriginal}
          onSubmit={submitOriginal}
          thread="thread-a"
        />
      </V2RuntimeProvider>,
    );

    await act(async () => fireEvent.press(screen.getByLabelText("Start voice")));
    act(() => startInput?.onEvent({ level: 0.6, type: "level" }));
    expect(screen.getByText("0.6")).toBeTruthy();
    rendered.rerender(
      <V2RuntimeProvider runtime={runtime}>
        <VoiceControlHarness onInsert={insertOther} onSubmit={submitOther} thread="thread-b" />
      </V2RuntimeProvider>,
    );
    expect(screen.getByText("recording")).toBeTruthy();
    expect(screen.getByText("0.6")).toBeTruthy();
    expect(cancel).not.toHaveBeenCalled();
    act(() => startInput?.onEvent({ level: 0.8, type: "level" }));
    expect(screen.getByText("0.8")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByLabelText("Submit voice")));

    expect(start).toHaveBeenCalledTimes(1);
    expect(submitOriginal).toHaveBeenCalledWith("message for the original chat");
    expect(submitOther).not.toHaveBeenCalled();
    expect(insertOriginal).not.toHaveBeenCalled();
    expect(insertOther).not.toHaveBeenCalled();
  });

  it("exposes a stable device-test hook for global voice controls", () => {
    render(
      <VoiceCaptureControls
        disabled={false}
        level={0.5}
        message="Listening…"
        onCancel={jest.fn(async () => undefined)}
        onFailure={jest.fn()}
        onFinish={jest.fn(async () => undefined)}
        onRetry={jest.fn(async () => undefined)}
        onStart={jest.fn(async () => undefined)}
        state="recording"
      />,
    );

    expect(screen.getByTestId("v2-global-voice-controls")).toBeTruthy();
  });

  it("keeps process-owned recording across UI background, resume, and generation change", async () => {
    const cancel = jest.fn(async () => undefined);
    const controller = new VoiceInputController({
      start: async (input) => {
        input.onEvent({ type: "recording" });
        return { cancel, finish: async () => undefined };
      },
    });
    const runtime = { voice: controller } as V2Runtime;
    const onInsert = jest.fn();
    const onSubmit = jest.fn(async () => true);
    const backgrounded = render(
      <V2RuntimeProvider runtime={runtime}>
        <VoiceControlHarness onInsert={onInsert} onSubmit={onSubmit} />
      </V2RuntimeProvider>,
    );

    await act(async () => fireEvent.press(screen.getByLabelText("Start voice")));
    backgrounded.unmount();
    expect(cancel).not.toHaveBeenCalled();
    expect(
      controller.snapshot(
        voiceInputScopeKey(savedServerId("server-a"), { id: "thread-a", kind: "composer" }),
      ).state,
    ).toBe("recording");

    render(
      <V2RuntimeProvider runtime={runtime}>
        <VoiceControlHarness onInsert={onInsert} onSubmit={onSubmit} sourceGeneration="2" />
      </V2RuntimeProvider>,
    );
    expect(screen.getByText("recording")).toBeTruthy();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("publishes bounded microphone levels only while recording", async () => {
    let startInput: VoiceTransportStartInput | null = null;
    const controller = new VoiceInputController({
      start: async (input) => {
        startInput = input;
        input.onEvent({ type: "recording" });
        return { cancel: async () => undefined, finish: async () => undefined };
      },
    });
    const runtime = { voice: controller } as V2Runtime;
    render(
      <V2RuntimeProvider runtime={runtime}>
        <VoiceControlHarness onInsert={jest.fn()} onSubmit={async () => true} />
      </V2RuntimeProvider>,
    );

    await act(async () => fireEvent.press(screen.getByLabelText("Start voice")));
    act(() => startInput?.onEvent({ level: 4, type: "level" }));
    expect(screen.getByText("1")).toBeTruthy();
    act(() => startInput?.onEvent({ level: Number.NaN, type: "level" }));
    expect(screen.getByText("0")).toBeTruthy();
  });

  it("exposes explicit cancel and retry actions without recapturing audio", async () => {
    let startInput: VoiceTransportStartInput | null = null;
    const cancel = jest.fn(async () => {
      startInput?.onEvent({ type: "cancelled" });
    });
    const finish = jest.fn(async () => {
      startInput?.onEvent({ retryAfterMs: 250, type: "retry" });
    });
    const controller = new VoiceInputController({
      start: async (input) => {
        startInput = input;
        input.onEvent({ type: "recording" });
        return { cancel, finish };
      },
    });
    const runtime = { voice: controller } as V2Runtime;
    render(
      <V2RuntimeProvider runtime={runtime}>
        <VoiceControlHarness onInsert={jest.fn()} onSubmit={async () => true} />
      </V2RuntimeProvider>,
    );

    await act(async () => fireEvent.press(screen.getByLabelText("Start voice")));
    await act(async () => fireEvent.press(screen.getByLabelText("Finish voice")));
    expect(screen.getByText("retry")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByLabelText("Retry voice")));
    expect(finish).toHaveBeenCalledTimes(2);
    await act(async () => fireEvent.press(screen.getByLabelText("Cancel voice")));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByText("idle")).toBeTruthy();
  });

  it("publishes cancelling and retires native capture even without a cancelled event", async () => {
    let releaseCancel: (() => void) | null = null;
    const cancel = jest.fn(
      async () =>
        new Promise<void>((resolve) => {
          releaseCancel = resolve;
        }),
    );
    const controller = new VoiceInputController({
      start: async (input) => {
        input.onEvent({ type: "recording" });
        return { cancel, finish: async () => undefined };
      },
    });
    const runtime = { voice: controller } as V2Runtime;
    render(
      <V2RuntimeProvider runtime={runtime}>
        <VoiceControlHarness onInsert={jest.fn()} onSubmit={async () => true} />
      </V2RuntimeProvider>,
    );

    await act(async () => fireEvent.press(screen.getByLabelText("Start voice")));
    await act(async () => {
      fireEvent.press(screen.getByLabelText("Cancel voice"));
      await Promise.resolve();
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByText("cancelling")).toBeTruthy();

    await act(async () => {
      releaseCancel?.();
      await Promise.resolve();
    });
    expect(screen.getByText("idle")).toBeTruthy();
  });

  it("cancels an in-flight submit without surfacing a synthetic failure", async () => {
    const neverFinishes = new Promise<void>(() => undefined);
    const cancel = jest.fn(async () => undefined);
    const controller = new VoiceInputController({
      start: async (input) => {
        input.onEvent({ type: "recording" });
        return { cancel, finish: async () => neverFinishes };
      },
    });
    const runtime = { voice: controller } as V2Runtime;
    render(
      <V2RuntimeProvider runtime={runtime}>
        <VoiceControlHarness onInsert={jest.fn()} onSubmit={async () => true} />
      </V2RuntimeProvider>,
    );

    await act(async () => fireEvent.press(screen.getByLabelText("Start voice")));
    act(() => fireEvent.press(screen.getByLabelText("Submit voice")));
    expect(screen.getByText("finishing")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByLabelText("Cancel voice")));

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByText("idle")).toBeTruthy();
  });

  it("delivers an inserted transcript when its original chat mounts again", async () => {
    let startInput: VoiceTransportStartInput | null = null;
    const finish = jest.fn(async () => {
      startInput?.onEvent({ text: "draft for chat a", type: "result" });
    });
    const controller = new VoiceInputController({
      start: async (input) => {
        startInput = input;
        input.onEvent({ type: "recording" });
        return { cancel: async () => undefined, finish };
      },
    });
    const runtime = { voice: controller } as V2Runtime;
    const insertOriginal = jest.fn();
    const insertOther = jest.fn();
    const submit = jest.fn(async () => true);
    const rendered = render(
      <V2RuntimeProvider runtime={runtime}>
        <VoiceControlHarness onInsert={insertOriginal} onSubmit={submit} thread="thread-a" />
      </V2RuntimeProvider>,
    );

    await act(async () => fireEvent.press(screen.getByLabelText("Start voice")));
    rendered.rerender(
      <V2RuntimeProvider runtime={runtime}>
        <VoiceControlHarness onInsert={insertOther} onSubmit={submit} thread="thread-b" />
      </V2RuntimeProvider>,
    );
    await act(async () => fireEvent.press(screen.getByLabelText("Start voice")));
    expect(insertOriginal).not.toHaveBeenCalled();
    expect(insertOther).not.toHaveBeenCalled();

    rendered.rerender(
      <V2RuntimeProvider runtime={runtime}>
        <VoiceControlHarness onInsert={insertOriginal} onSubmit={submit} thread="thread-a" />
      </V2RuntimeProvider>,
    );
    expect(insertOriginal).toHaveBeenCalledWith("draft for chat a");
    expect(insertOther).not.toHaveBeenCalled();
  });
});

interface VoiceControlHarnessProps {
  onInsert(text: string): void;
  onSubmit(text: string): Promise<boolean>;
  sourceGeneration?: string;
  thread?: string;
}

function VoiceControlHarness(props: VoiceControlHarnessProps): React.JSX.Element {
  const { onInsert, onSubmit, sourceGeneration = "1", thread = "thread-a" } = props;
  const audience = savedServerId("server-a");
  const scope = { id: thread, kind: "composer" as const };
  const control = useVoiceInputControl({
    audience,
    live: true,
    onSubmitTranscript: onSubmit,
    onTranscript: onInsert,
    // WHY: The hook consumes only sourceGeneration; a full projection fixture would couple this focused test to unrelated reducer state.
    projection: { sourceGeneration } as V2Projection,
    scope,
    thread: { savedServerId: audience, threadId: threadId(thread) },
  });
  const level = useVoiceInputLevel(audience, scope);
  const submitVoice = useEvent((): void => {
    control.submitTranscript().catch(() => undefined);
  });
  return (
    <>
      <Text>{control.captureState}</Text>
      <Text>{level}</Text>
      <Pressable accessibilityLabel="Start voice" onPress={control.activate} />
      <Pressable accessibilityLabel="Cancel voice" onPress={control.cancel} />
      <Pressable accessibilityLabel="Finish voice" onPress={control.finishTranscript} />
      <Pressable accessibilityLabel="Retry voice" onPress={control.retry} />
      <Pressable accessibilityLabel="Submit voice" onPress={submitVoice} />
    </>
  );
}
