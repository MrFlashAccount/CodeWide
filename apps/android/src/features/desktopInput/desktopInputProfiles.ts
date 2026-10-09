import { desktopKeyCodes, desktopModifierBits } from "../../native/desktopInputCodes";
import type { DesktopKeyChord } from "../../native/desktopInputContract";

/** Supported task-specific button sets. */
export type DesktopProfileId = "general" | "devtools" | "perfetto";
/** Named key chord exposed by a control profile. */
export type DesktopShortcut = DesktopKeyChord & { readonly label: string };

const navigation: readonly DesktopShortcut[] = [
  { keyCode: desktopKeyCodes.escape, label: "Esc", modifiers: 0 },
  { keyCode: desktopKeyCodes.tab, label: "Tab", modifiers: 0 },
  { keyCode: desktopKeyCodes.enter, label: "Enter", modifiers: 0 },
  { keyCode: desktopKeyCodes.left, label: "←", modifiers: 0 },
  { keyCode: desktopKeyCodes.up, label: "↑", modifiers: 0 },
  { keyCode: desktopKeyCodes.down, label: "↓", modifiers: 0 },
  { keyCode: desktopKeyCodes.right, label: "→", modifiers: 0 },
];

/** Built-in profiles; each surface selects its own profile. */
export const desktopInputProfiles: Readonly<
  Record<
    DesktopProfileId,
    {
      readonly label: string;
      readonly shortcuts: readonly DesktopShortcut[];
    }
  >
> = {
  devtools: {
    label: "DevTools",
    shortcuts: [
      {
        keyCode: desktopKeyCodes.p,
        label: "Commands",
        modifiers: desktopModifierBits.ctrl | desktopModifierBits.shift,
      },
      { keyCode: desktopKeyCodes.f, label: "Find", modifiers: desktopModifierBits.ctrl },
      { keyCode: desktopKeyCodes.f8, label: "Resume", modifiers: 0 },
      { keyCode: desktopKeyCodes.f10, label: "Step over", modifiers: 0 },
      { keyCode: desktopKeyCodes.f11, label: "Step into", modifiers: 0 },
      { keyCode: desktopKeyCodes.f11, label: "Step out", modifiers: desktopModifierBits.shift },
      ...navigation,
    ],
  },
  general: { label: "General", shortcuts: navigation },
  perfetto: {
    label: "Perfetto",
    shortcuts: [
      { keyCode: desktopKeyCodes.w, label: "Zoom +", modifiers: 0 },
      { keyCode: desktopKeyCodes.s, label: "Zoom −", modifiers: 0 },
      { keyCode: desktopKeyCodes.a, label: "Pan ←", modifiers: 0 },
      { keyCode: desktopKeyCodes.d, label: "Pan →", modifiers: 0 },
      { keyCode: desktopKeyCodes.f, label: "Fit", modifiers: 0 },
      {
        keyCode: desktopKeyCodes.p,
        label: "Commands",
        modifiers: desktopModifierBits.ctrl | desktopModifierBits.shift,
      },
      ...navigation,
    ],
  },
};

/** Cycles through the available control profiles. */
export function nextDesktopProfile(profile: DesktopProfileId): DesktopProfileId {
  if (profile === "general") {
    return "devtools";
  }
  return profile === "devtools" ? "perfetto" : "general";
}
