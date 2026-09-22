import { setStringAsync } from "expo-clipboard";
import { useRef, useState } from "react";

import {
  captureWindowDiagnosticReport,
  setWindowDiagnosticRecording,
} from "../../data/windowDiagnostics";
import { useEvent } from "../../react/useEvent";

type CopyState = "idle" | "copying" | "copied" | "error";

/** Owns explicit user actions and clipboard feedback, not the observation session lifetime. */
export function useWindowDiagnosticActions(): {
  readonly copy: () => void;
  readonly copyState: CopyState;
  readonly toggle: (enabled: boolean) => Promise<void>;
} {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const copyInFlight = useRef(false);
  const toggle = useEvent(async (enabled: boolean) => {
    setCopyState("idle");
    await setWindowDiagnosticRecording(enabled);
  });
  const copy = useEvent(() => {
    if (copyInFlight.current) {
      return;
    }
    copyInFlight.current = true;
    setCopyState("copying");
    void captureWindowDiagnosticReport()
      .then(setStringAsync)
      .then(
        () => {
          copyInFlight.current = false;
          setCopyState("copied");
        },
        () => {
          copyInFlight.current = false;
          setCopyState("error");
        },
      );
  });
  return { copy, copyState, toggle };
}
