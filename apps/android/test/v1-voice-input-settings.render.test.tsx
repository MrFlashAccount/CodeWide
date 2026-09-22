import { fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { VoiceInputSettings } from "../src/features/settings/VoiceInputSettings";
import type { VoiceInputSnapshot } from "../src/native/globalVoiceAudioRouteContract";

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

const snapshot: VoiceInputSnapshot = {
  active: true, bluetoothCoupled: false,
  devices: [{ id: 1, kind: "builtin", label: "Phone" }, { id: 8, kind: "usb", label: "USB headset" }],
  fallback: "unavailable", muted: false, preference: "bluetooth",
  routedInput: { id: 1, kind: "builtin", label: "Phone" },
};

it("separates saved intent, actual input, mute and explicit fallback", () => {
  const onSelect = jest.fn(async () => undefined);
  const view = render(<VoiceInputSettings snapshot={snapshot} onSelect={onSelect} />);
  expect(view.getByText("Saved preference: Bluetooth microphone")).toBeTruthy();
  expect(view.getByText("Active input: Phone microphone · Phone")).toBeTruthy();
  expect(view.getByText(/Using System default/)).toBeTruthy();
  view.rerender(<VoiceInputSettings snapshot={{ ...snapshot, muted: true, routedInput: null }} onSelect={onSelect} />);
  expect(view.getByText("Active input: Microphone off")).toBeTruthy();
  view.rerender(<VoiceInputSettings snapshot={{ ...snapshot, active: false, routedInput: null, fallback: "none" }} onSelect={onSelect} />);
  expect(view.getByText("Active input: No active voice session")).toBeTruthy();
  expect(view.getByText("Saved preference: Bluetooth microphone")).toBeTruthy();
});

it("selects a currently connected device without presenting it as a confirmed route", async () => {
  const onSelect = jest.fn(async () => undefined);
  const view = render(<VoiceInputSettings snapshot={snapshot} onSelect={onSelect} />);
  fireEvent.press(view.getByRole("button", { name: "Use USB microphone: USB headset" }));
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith("usb", 8));
  expect(view.getByText("Active input: Phone microphone · Phone")).toBeTruthy();
  await waitFor(() => expect(view.getByRole("button", { name: "Use System default microphone" })).not.toBeDisabled());
  fireEvent.press(view.getByRole("button", { name: "Use System default microphone" }));
  await waitFor(() => expect(onSelect).toHaveBeenLastCalledWith("system", null));
});
