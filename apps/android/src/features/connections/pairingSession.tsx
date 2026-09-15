/** V1 ConnectionSheet owner, extracted without changing interaction or resource lifetime. */
import { useCameraPermissions } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { type ConnectionInput } from "../../data/connection-validation";
import { useAppFullscreenOverlay } from "../../ui/AppFullscreenOverlay";
import { pairingEndpointLabel, pairingParseResult } from "./pairing";
import { humanPairingError } from "./pairingError";
import { PairingQrScanner } from "./PairingQrScanner";

import { useEvent } from "../../react/useEvent";
import type { ConnectionSheetSessionProps } from "./connectionSheetContract";

/** Owns pairing form reset, retained scanner callbacks and save completion for one mounted session. */
export function usePairingSession({
  visible,
  initialCode,
  localReady,
  localError,
  onSave,
  onClose,
  setSaving,
}: ConnectionSheetSessionProps) {
  const openIdentity = visible ? (initialCode === null ? "manual" : `code:${initialCode}`) : null;
  const initialPairing = initialCode === null ? null : pairingParseResult(initialCode);
  const initialValue = initialPairing?.value ?? null;
  const [presentedOpenIdentity, setPresentedOpenIdentity] = useState(openIdentity);
  const [mode, setMode] = useState<"choose" | "review" | "manual" | "success">(
    initialValue === null ? "choose" : "review",
  );
  const [displayName, setDisplayName] = useState(initialValue?.displayName ?? "");
  const [emoji, setEmoji] = useState(initialValue?.emoji ?? "🖥️");
  const [endpoint, setEndpoint] = useState(initialValue?.endpoint ?? "");
  const [token, setToken] = useState(initialValue?.pairingToken ?? "");
  const [tlsPinSha256, setTlsPinSha256] = useState(initialValue?.tlsPinSha256 ?? "");
  const [expiresAt, setExpiresAt] = useState<number | null>(initialValue?.expiresAt ?? null);
  const [pairingParsedAt, setPairingParsedAt] = useState<number | null>(
    initialPairing?.parsedAt ?? null,
  );
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const fullscreenOverlay = useAppFullscreenOverlay();
  const [error, setError] = useState<string | null>(initialPairing?.error ?? null);
  if (openIdentity !== null && openIdentity !== presentedOpenIdentity) {
    // This is a new pairing session, not synchronization with an external
    // system. Adjust the session state during render so React discards the
    // stale render before committing it; keeping the child mounted preserves
    // AppSheet's close animation and avoids a post-paint reset effect.
    setPresentedOpenIdentity(openIdentity);
    setMode(initialValue === null ? "choose" : "review");
    setDisplayName(initialValue?.displayName ?? "");
    setEmoji(initialValue?.emoji ?? "🖥️");
    setEndpoint(initialValue?.endpoint ?? "");
    setToken(initialValue?.pairingToken ?? "");
    setTlsPinSha256(initialValue?.tlsPinSha256 ?? "");
    setExpiresAt(initialValue?.expiresAt ?? null);
    setPairingParsedAt(initialPairing?.parsedAt ?? null);
    setError(initialPairing?.error ?? null);
  } else if (openIdentity === null && presentedOpenIdentity !== null) {
    // Preserve the rendered contents through the closing animation. Marking
    // the session closed makes the next open a new identity and resets it.
    setPresentedOpenIdentity(null);
  }
  const consumeCode = useEvent((raw: string): string | null => {
    const result = pairingParseResult(raw);
    if (result.value !== null) {
      const pairing = result.value;
      setDisplayName(pairing.displayName);
      setEmoji(pairing.emoji);
      setEndpoint(pairing.endpoint);
      setToken(pairing.pairingToken);
      setTlsPinSha256(pairing.tlsPinSha256);
      setExpiresAt(pairing.expiresAt);
      setPairingParsedAt(result.parsedAt);
      setError(null);
      setMode("review");
      return null;
    }
    setError(result.error);
    return result.error;
  });
  const pasteCode = useEvent(async () => {
    setError(null);
    const value = await Clipboard.getStringAsync();
    if (value.trim() === "") {
      setError("Clipboard is empty. Copy the connection link from your host first.");
      return;
    }
    consumeCode(value);
  });
  const openPairingScanner = useEvent(async () => {
    let permission = cameraPermission;
    if (permission?.granted !== true && (permission === null || permission.canAskAgain)) {
      permission = await requestCameraPermission();
    }
    fullscreenOverlay.present(({ close: closeScanner }) => (
      <PairingQrScanner
        initialPermission={permission}
        requestPermission={requestCameraPermission}
        onClose={closeScanner}
        onScan={(raw) => {
          const message = consumeCode(raw);
          if (message === null) closeScanner();
          return message;
        }}
      />
    ));
  });
  const save = useEvent(async () => {
    if (!localReady) {
      setError(localError ?? "Local storage is still preparing. Try again in a moment.");
      return;
    }
    setSaving(true);
    setError(null);
    const input: ConnectionInput = {
      displayName,
      emoji,
      endpoint,
      token,
      ...(tlsPinSha256.trim() === "" ? {} : { tlsPinSha256 }),
    };
    try {
      await onSave(input);
      setMode("success");
      await new Promise<void>((resolve) => setTimeout(resolve, 650));
      setSaving(false);
      onClose();
      return;
    } catch (cause) {
      setError(humanPairingError(cause));
    }
    setSaving(false);
  });
  const endpointLabel = pairingEndpointLabel(endpoint);
  const minutesLeft =
    expiresAt === null || pairingParsedAt === null
      ? null
      : Math.max(0, Math.ceil((expiresAt - pairingParsedAt) / 60_000));
  return {
    mode,
    setMode,
    displayName,
    setDisplayName,
    emoji,
    setEmoji,
    endpoint,
    setEndpoint,
    token,
    setToken,
    tlsPinSha256,
    setTlsPinSha256,
    error,
    setError,
    pasteCode,
    openPairingScanner,
    save,
    endpointLabel,
    minutesLeft,
  };
}

/** State machine returned by the server-pairing session hook. */
export type PairingSession = ReturnType<typeof usePairingSession>;
