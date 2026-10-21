import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import {
  voiceHandoffBehavior$,
  writeVoiceHandoffPreference,
} from "../src/data/voiceHandoffPreference";
import { ChatSettings } from "../src/features/settings/ChatSettings";

jest.mock("../src/data/voiceHandoffPreference", () => {
  const { observablePrimitive } =
    jest.requireActual<typeof import("@legendapp/state")>("@legendapp/state");
  const behavior$ = observablePrimitive("send");
  return {
    voiceHandoffBehavior$: behavior$,
    writeVoiceHandoffPreference: jest.fn(async (behavior: string) => {
      behavior$.set(behavior);
    }),
  };
});

beforeEach(() => {
  voiceHandoffBehavior$.set("send");
  jest.clearAllMocks();
});

it("shows the cross-chat microphone policy and persists a new selection", async () => {
  const view = render(<ChatSettings />);
  expect(view.getByText("Stop and send")).toBeTruthy();

  fireEvent.press(view.getByLabelText("Microphone in another chat"));
  fireEvent.press(view.getByLabelText("Microphone in another chat: Stop and keep draft"));

  await waitFor(() => {
    expect(writeVoiceHandoffPreference).toHaveBeenCalledWith("stop");
    expect(view.getAllByText("Stop and keep draft").length).toBeGreaterThanOrEqual(2);
  });
  act(() => {
    voiceHandoffBehavior$.set("send");
  });
});
