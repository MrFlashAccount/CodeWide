import type { ReactNode, Ref } from "react";

/** A keyboard chord delivered to one explicitly attached input surface. */
export type DesktopKeyChord = {
  readonly keyCode: number;
  readonly modifiers: number;
};

/** Imperative commands delivered only while the attached surface is enabled. */
export type DesktopInputTargetHandle = {
  readonly click: (button: number) => void;
  readonly keyboard: () => void;
  readonly sendKey: (chord: DesktopKeyChord) => void;
};

/** Local input state only; this contract contains no page content or destinations. */
export type DesktopInputTargetProps = {
  readonly children: ReactNode;
  readonly enabled: boolean;
  readonly heldButton: number;
  readonly modifiers: number;
  readonly onReset: () => void;
  readonly ref: Ref<DesktopInputTargetHandle>;
  readonly sensitivity: number;
  readonly sessionKey: string;
};
