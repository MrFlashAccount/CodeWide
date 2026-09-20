import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import { render, waitFor } from "@testing-library/react-native";

import type {
  VoiceInputRow,
  WorkspaceResourceDatabase,
} from "../src/data/workspace-resource-database";
import { useComposerVoiceState } from "../src/features/composer/voice";
import { AppNoticeContext } from "../src/ui/appNoticeContext";

it("presents composer microphone failures through the application notice surface", async () => {
  const voiceInputs = createCollection(
    localOnlyCollectionOptions<VoiceInputRow, string>({ getKey: (row) => row.id }),
  );
  voiceInputs.insert({
    backend: "remote",
    error: "Microphone is already in use",
    id: "composer",
    level: 0,
    pendingSelection: null,
    phase: "idle",
    retryAvailable: false,
    scope: "composer",
    seconds: 0,
    updatedAt: 0,
  });
  // WHY: This hook consumes only voiceInputs, and the database owner exposes no narrower constructor for a render fixture.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const resources = { voiceInputs } as WorkspaceResourceDatabase;
  const show = jest.fn();
  function ComposerVoiceProbe(): null {
    useComposerVoiceState("composer", resources, "server", "thread");
    return null;
  }

  const view = render(
    <AppNoticeContext.Provider value={{ show }}>
      <ComposerVoiceProbe />
    </AppNoticeContext.Provider>,
  );

  await waitFor(() => {
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith({
      duration: 3000,
      label: "Microphone is already in use",
    });
  });
  view.unmount();
  await voiceInputs.cleanup();
});
