import { fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { VoiceAssistantSettings } from "../src/features/settings/VoiceAssistantSettings";
import { VoiceSettings } from "../src/features/settings/VoiceSettings";

// WHY: Node cannot host the external Compose runtime. Exercise the real voice settings and
// AppListRow adapter while replacing only the unavailable platform surface.
jest.mock("@expo/ui/jetpack-compose", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const {
    Pressable: NativePressable,
    Text: NativeText,
    View: NativeView,
  } = jest.requireActual<typeof import("react-native")>("react-native");
  const Slot = ({ children }: { readonly children?: ReactNode }) => (
    <NativeView>{children}</NativeView>
  );
  const ListItem = Object.assign(Slot, {
    HeadlineContent: Slot,
    LeadingContent: Slot,
    SupportingContent: Slot,
    TrailingContent: Slot,
  });
  return {
    CircularProgressIndicator: Slot,
    Host: Slot,
    Icon: Slot,
    ListItem,
    RNHostView: Slot,
    Row: Slot,
    Text: NativeText,
    Button: NativePressable,
  };
});

it("selects a ChatGPT voice and previews the selected GPT Live voice once", async () => {
  const select = jest.fn(async () => undefined);
  const previewCompletion = Promise.withResolvers<void>();
  const preview = jest.fn(() => previewCompletion.promise);
  const view = render(<VoiceSettings onPreview={preview} onSelect={select} selectedVoice="cove" />);

  expect(view.getByRole("radio", { name: "Select Cove voice", checked: true })).toBeTruthy();
  expect(view.getByText("Composed and direct")).toBeTruthy();
  expect(view.getByRole("button", { name: "Play Cove voice sample" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Play Juniper voice sample" })).toBeNull();
  expect(view.queryByText("Play sample")).toBeNull();
  fireEvent.press(view.getByRole("radio", { name: "Select Juniper voice" }));
  await waitFor(() => expect(select).toHaveBeenCalledWith("juniper"));
  await waitFor(() => expect(preview).toHaveBeenCalledWith("juniper"));

  view.rerender(<VoiceSettings onPreview={preview} onSelect={select} selectedVoice="juniper" />);
  const sample = view.getByRole("button", { name: "Play Juniper voice sample" });
  expect(view.queryByRole("button", { name: "Play Cove voice sample" })).toBeNull();
  fireEvent.press(sample);
  fireEvent.press(sample);
  expect(preview).toHaveBeenCalledTimes(1);
  expect(sample.props.accessibilityState).toMatchObject({ busy: true, disabled: true });

  previewCompletion.resolve();
  await waitFor(() =>
    expect(
      view.getByRole("button", { name: "Play Juniper voice sample" }).props.accessibilityState,
    ).toMatchObject({ busy: false, disabled: false }),
  );
});

it("surfaces preview failure without changing the selected voice", async () => {
  const view = render(
    <VoiceSettings
      onPreview={async () => {
        throw new Error("transport failed");
      }}
      onSelect={async () => undefined}
      selectedVoice="spruce"
    />,
  );

  fireEvent.press(view.getByRole("radio", { name: "Select Spruce voice", checked: true }));
  await waitFor(() => expect(view.getByText("Could not play this voice sample.")).toBeTruthy());
  expect(view.getByRole("radio", { name: "Select Spruce voice", checked: true })).toBeTruthy();
});

it("surfaces the Companion API-key requirement without waiting for a generic timeout", async () => {
  const view = render(
    <VoiceSettings
      onPreview={async () => {
        throw new Error("realtime conversation requires API key auth");
      }}
      onSelect={async () => undefined}
      selectedVoice="cove"
    />,
  );

  fireEvent.press(view.getByRole("button", { name: "Play Cove voice sample" }));
  await waitFor(() =>
    expect(
      view.getByText("Voice samples require OpenAI API key authentication on Companion."),
    ).toBeTruthy(),
  );
});

it("saves one structured personality without changing the synthesized voice", async () => {
  const selectVoice = jest.fn(async () => undefined);
  const previewVoice = jest.fn(async () => undefined);
  const savePersonality = jest.fn(async () => undefined);
  const view = render(
    <VoiceAssistantSettings
      onPreviewVoice={previewVoice}
      onSavePersonality={savePersonality}
      onSelectOrbStyle={async () => undefined}
      onSelectVoice={selectVoice}
      personality={{ character: "", communicationStyle: "", rules: "" }}
      selectedOrbStyle="nebula"
      selectedVoice="cove"
    />,
  );

  const saveButton = view.getByRole("button", { name: "Save Voice Assistant personality" });
  expect(saveButton).toHaveStyle({ alignSelf: "stretch" });
  expect(saveButton.props.accessibilityState).toMatchObject({
    disabled: true,
  });
  fireEvent.changeText(view.getByLabelText("Voice Assistant character"), "  Calm and candid  ");
  fireEvent.changeText(
    view.getByLabelText("Voice Assistant communication style"),
    "Short spoken answers",
  );
  fireEvent.changeText(view.getByLabelText("Voice Assistant rules"), "State uncertainty clearly");
  fireEvent.press(view.getByRole("button", { name: "Save Voice Assistant personality" }));

  await waitFor(() =>
    expect(savePersonality).toHaveBeenCalledWith({
      character: "Calm and candid",
      communicationStyle: "Short spoken answers",
      rules: "State uncertainty clearly",
    }),
  );
  expect(selectVoice).not.toHaveBeenCalled();
  expect(previewVoice).not.toHaveBeenCalled();
  expect(
    view.getByText("Personality saved. It will apply the next time Voice Assistant starts."),
  ).toBeTruthy();
});

it("keeps an unsaved personality draft visible when persistence fails", async () => {
  const view = render(
    <VoiceAssistantSettings
      onPreviewVoice={async () => undefined}
      onSavePersonality={async () => {
        throw new Error("disk unavailable");
      }}
      onSelectOrbStyle={async () => undefined}
      onSelectVoice={async () => undefined}
      personality={{ character: "", communicationStyle: "", rules: "" }}
      selectedOrbStyle="nebula"
      selectedVoice="cove"
    />,
  );

  fireEvent.changeText(view.getByLabelText("Voice Assistant rules"), "Never pretend certainty");
  fireEvent.press(view.getByRole("button", { name: "Save Voice Assistant personality" }));

  await waitFor(() =>
    expect(view.getByText("Could not save the Voice Assistant personality.")).toBeTruthy(),
  );
  expect(view.getByDisplayValue("Never pretend certainty")).toBeTruthy();
});

it("shows deterministic orb previews and switches only the visual preference", async () => {
  const selectOrbStyle = jest.fn(async () => undefined);
  const selectVoice = jest.fn(async () => undefined);
  const savePersonality = jest.fn(async () => undefined);
  const view = render(
    <VoiceAssistantSettings
      onPreviewVoice={async () => undefined}
      onSavePersonality={savePersonality}
      onSelectOrbStyle={selectOrbStyle}
      onSelectVoice={selectVoice}
      personality={{ character: "", communicationStyle: "", rules: "" }}
      selectedOrbStyle="nebula"
      selectedVoice="cove"
    />,
  );

  expect(
    view.getByRole("radio", { name: "Use Nebula Voice Assistant orb", checked: true }),
  ).toBeTruthy();
  expect(view.getByText("◉  Nebula")).toBeTruthy();
  expect(view.getByText("·••·  Particles")).toBeTruthy();

  fireEvent.press(view.getByRole("radio", { name: "Use Particles Voice Assistant orb" }));

  await waitFor(() => expect(selectOrbStyle).toHaveBeenCalledWith("particles"));
  expect(selectVoice).not.toHaveBeenCalled();
  expect(savePersonality).not.toHaveBeenCalled();
});
