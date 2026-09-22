import { NativeModules } from "react-native";

type NativePeerBridge = {
  readonly observeWebRtc: (peerId: number) => Promise<void>;
  readonly stopObservingWebRtc: (peerId: number) => void;
};

/** Attaches service-owned presentation to this exact peer before negotiation can emit speech. */
export async function observeGlobalVoiceNativePeer(peerId: number): Promise<() => void> {
  // WHY: This same-binary React Native registry has no generated module contract; the peer id
  // comes from react-native-webrtc and is validated again at the Kotlin boundary.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const bridge = NativeModules.CodeWideGlobalVoiceForeground as NativePeerBridge;
  await bridge.observeWebRtc(peerId);
  return () => {
    bridge.stopObservingWebRtc(peerId);
  };
}
