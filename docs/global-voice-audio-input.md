# Global Voice capture and input routing

## Capture authority

The WebRTC session owns microphone intent and serial reconciliation. Mute immediately disables every owned track and closes the native ADM microphone gate, then detaches the sender and releases capture. A successful acknowledgement publishes the actual mute state. Unmute captures a fresh track and attaches it to the existing sender/peer before reopening the gate. No new SDP/session is required by the pinned transport.

Each intent has a revision. A late capture or attach result cannot enable an older intent; duplicate requests wait for the current transition. The activation forwards intent immediately rather than queuing mute behind slow acquisition. Only the latest acknowledgement updates presentation. A failed microphone mutation terminates the activation through its existing cleanup path instead of displaying a successful mute. UI visibility does not own the mute state.

The patched pinned `react-native-webrtc` sender rejects missing tracks and native `setTrack` failure instead of swallowing the error and publishing a false acknowledgement. Stream release frees native tracks; disabling a track alone is not resource disposal. Stop closes playback/peer immediately, fences pending acquisition, releases late streams and restores the audio route once reconciliation completes. Repeated Stop shares one cleanup promise.

Contract tests inject frames at the capture/sender seam: after mute they do not reach the sender, after unmute they do, and the same peer remains. This is deterministic boundary evidence with platform doubles, **not proof of microphone/RTP behavior on a handset**.

## Input preference and observed route

`VoiceInputRouteOwner` owns one native Global Voice audio lease. SharedPreferences stores only route kind: system, built-in, wired, USB, Bluetooth or BLE. A concrete connected device id is ephemeral. On acquisition the current device inventory resolves the saved kind again. Settings shows the saved preference separately from the input observed through Android recording configurations; selecting a row never fabricates an active route.

System default sets no explicit communication mode. Built-in, wired and USB inputs request the device through the pinned Jitsi 124 JavaAudioDeviceModule's `setPreferredInputDevice`. Its nullable reset restores system selection. Disappearance or an unconfirmed/rejected route clears the preferred device and shows an explicit System default fallback while retaining the saved kind. Route confirmation begins only after recording actually starts. Muted capture has no claimed active input.

Explicit Bluetooth/BLE selection requests the corresponding communication device for this lease only, with `BLUETOOTH_CONNECT` permission. Android's [communication-device API](https://developer.android.com/reference/android/media/AudioManager#setCommunicationDevice(android.media.AudioDeviceInfo)) selects an output and automatically chooses its associated input. Consequently Bluetooth input can also change output profile/quality; Settings states this limitation. Independent input/output selection is not promised.

The communication override snapshots the previous mode/route, releases its own request and restores the prior mode on Stop, failure, device loss or bridge invalidation. It avoids replacing a communication route subsequently taken over by another call. There is no process-wide forced communication mode for default/media playback.

## Validation boundary

Native owner tests cover saved-kind resolution with changing device ids, disappearance, rejected/incorrect observed routes, default fallback and idempotent restoration. Render tests distinguish saved preference, actual input, mute and fallback. WebRTC/activation tests cover immediate gating, rapid off/on races, late acquisition, native mutation failure and Stop cleanup.

Physical acceptance is still required for each available input family (built-in, wired/USB, Bluetooth/BLE), actual transmitted speech after mute, profile/output changes and restoration after Stop/failure. These scenarios were not executed because adb reported no connected device. No release is authorized.
