import { setStringAsync } from "expo-clipboard";
import { useEffect, useRef, useState } from "react";

import { useEvent } from "../react/useEvent";
import { useAppDialog } from "../ui/AppDialog";

const COPY_FEEDBACK_DURATION_MS = 900;

/** Copies the latest value and briefly exposes confirmation to the owning control. */
export function useCopyFeedback(value: string): readonly [copied: boolean, copy: () => void] {
  const dialog = useAppDialog();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copy = useEvent(() => {
    setStringAsync(value).then(
      () => {
        setCopied(true);
      },
      (error: unknown) => {
        dialog.alert("Copy failed", error instanceof Error ? error.message : "Could not copy");
      },
    );
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setCopied(false);
    }, COPY_FEEDBACK_DURATION_MS);
  });
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );
  return [copied, copy];
}
