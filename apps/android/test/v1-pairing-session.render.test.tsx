import { act, renderHook } from "@testing-library/react-native";
import { encodePairingLink } from "@codewide/codex-protocol/pairing";
import type { ReactNode } from "react";
import { usePairingSession } from "../src/features/connections/pairingSession";
import { AppFullscreenOverlayProvider } from "../src/ui/AppFullscreenOverlay";

// WHY: Node has no camera permission/runtime module. The real pairing owner and
// overlay provider run here; device camera scanning remains a platform smoke check.
jest.mock("expo-camera", () => ({
  useCameraPermissions: () => [null, jest.fn()],
  CameraView: () => null,
}));

function wrapper({ children }: { children: ReactNode }) {
  return <AppFullscreenOverlayProvider>{children}</AppFullscreenOverlayProvider>;
}

function sessionProps() {
  return {
    visible: true,
    localReady: true,
    localError: null,
    onRetryStartup: jest.fn(async () => undefined),
    onClose: jest.fn(),
    onSave: jest.fn(async () => undefined),
    initialCode: null,
    saving: false,
    setSaving: jest.fn(),
  };
}

it("keeps closing content mounted and resets the next manual pairing open", () => {
  const props = sessionProps();
  const { result, rerender } = renderHook(usePairingSession, { initialProps: props, wrapper });
  expect(result.current.navigationDirection).toBeNull();
  act(() => {
    result.current.setMode("manual");
    result.current.setDisplayName("Edited server");
  });
  expect(result.current.navigationDirection).toBe("forward");
  act(() => result.current.setMode("choose"));
  expect(result.current.navigationDirection).toBe("back");
  act(() => result.current.setMode("manual"));
  rerender({ ...props, visible: false });
  expect(result.current.displayName).toBe("Edited server");
  expect(result.current.mode).toBe("manual");
  rerender(props);
  expect(result.current.displayName).toBe("");
  expect(result.current.mode).toBe("choose");
});

it("rejects save while local profiles are unavailable without consuming pairing", async () => {
  const props = { ...sessionProps(), localReady: false };
  const { result } = renderHook(usePairingSession, { initialProps: props, wrapper });
  await act(async () => result.current.save());
  expect(props.onSave).not.toHaveBeenCalled();
  expect(props.setSaving).not.toHaveBeenCalled();
  expect(result.current.error).toBe("Local storage is still preparing. Try again in a moment.");
});

it("passes both Relay and Companion pins from a WSS pairing link to secure pairing", async () => {
  const now = Date.now();
  const props = {
    ...sessionProps(),
    initialCode: encodePairingLink({
      type: "codewide-pairing",
      version: 2,
      endpoint: "wss://192.0.2.10:8780/v1/sync",
      pairingToken: "t".repeat(43),
      expiresAt: now + 60_000,
      displayName: "Host",
      emoji: "🖥️",
      tlsPinSha256: `sha256/${"A".repeat(43)}=`,
      relayRouteId: "a".repeat(64),
      relayTlsPinSha256: `sha256/${"B".repeat(43)}=`,
    }),
  };
  const { result } = renderHook(usePairingSession, { initialProps: props, wrapper });
  await act(async () => result.current.save());
  expect(props.onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      endpoint: "wss://192.0.2.10:8780/v1/sync",
      tlsPinSha256: `sha256/${"A".repeat(43)}=`,
      relay: { routeId: "a".repeat(64), tlsPinSha256: `sha256/${"B".repeat(43)}=` },
    }),
  );
});
