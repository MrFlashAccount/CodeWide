# Live input: semantic phase versus visible motion

Device feedback (2026-09-22): speech is recognized while the selected **Particles** orb appears
unresponsive. The user clarified that the semantic phase itself has not been observed.
No Android device was connected to this workspace's ADB during this investigation. The actual
on-device semantic phase is still **unconfirmed**. Comparison with the original demo and its
microphone hook has established and corrected a separate input-contract defect: the native
Particles renderer received linear PCM RMS where the original receives voice-band log-spectrum
normalization. No VAD wiring or particle animation constants were changed for this correction.
Physical-device confirmation is still required before closing the reported symptom.

## Observed code and parameter facts

- ADM input PCM reaches `GlobalVoiceAudioLevelOwner` independently of native presentation VAD.
  Successful recognition therefore cannot prove that the data channel publishes VAD edges.
- The RN WebRTC callback uses `dataChannelReceiveMessage`, `peerConnectionId`, `type="text"`
  and JSON text in `data`. Connection callbacks use `peerConnectionStateChanged`, `pcId` and
  `connectionState`. The installed patch routes both peer-id fields to the exact peer listener.
- `GlobalVoiceWebRtcSource` only admits recognized top-level event types, including
  `input_audio_buffer.speech_started/stopped`. Unknown shapes/types are not guessed or logged.
- `GlobalVoicePresentationOwner` accepts those VAD edges only with gate `listening` and mute off.
  Accepted user speech outranks thinking/playback. PCM amplitude never declares semantic speech.
- Source subscription is attached before negotiation and remains with the service through Activity
  changes. Observer closure drops queued events and pending stats. Each replacement peer gets new
  counters and an explicit attach/close log entry.
- A possible gate failure remains to be verified on-device: a CONNECTING publication after native
  connected can close the gate until another connected event. Another candidate is capture-health
  recovery while the presentation gate remains connecting. These are candidate traces, not the
  established explanation of this report; behavior is unchanged pending the semantic observation.

The renderer uses the pinned original [Particles geometry](https://github.com/amunozdev/voiceorbs/blob/339ab42d98f6c4ffa03709ffa71f9f6965a2171a/src/registry/orbe/particles-orb/particles-orb.tsx)
and [state motion](https://github.com/amunozdev/voiceorbs/blob/339ab42d98f6c4ffa03709ffa71f9f6965a2171a/src/registry/lib/orb-state.ts).
The [original level adapter](https://github.com/amunozdev/voiceorbs/blob/339ab42d98f6c4ffa03709ffa71f9f6965a2171a/src/registry/lib/use-orb-level.ts)
uses live input when supplied, otherwise synthetic listening energy between 0.4 and 0.9.
The original [microphone hook](https://github.com/amunozdev/voiceorbs/blob/339ab42d98f6c4ffa03709ffa71f9f6965a2171a/src/registry/lib/use-audio-level.ts)
uses a 512-point FFT, Blackman window, AnalyserNode -100..-30 dB byte spectrum, bins 85..3800 Hz,
65% band mean plus 35% peak, floor 0.14 and range 0.62. Spectrum smoothing is 0.7 and output
smoothing is 0.15 per animation frame. The demo with the microphone disabled instead uses
procedural energy; that is not evidence of real microphone amplitude.

Before this correction, native capture passed RMS directly, omitting that adapter. The new
`ParticlesVoiceInputLevel` restores its constants at a fixed 60 Hz of captured audio, independent
of callback segmentation and Activity/display cadence. It retains a bounded transient 512-sample
mono window plus FFT scratch buffers; these are never logged or persisted and are cleared on
mute, Stop and sample-rate replacement. RMS remains independently available for Nebula and
capture diagnostics. Only Particles selects the normalized spectrum; playback stays separate.
Style replacement immediately replays the appropriate input. The original ripple/flow/pulse
geometry and existing native attack/release rates remain unchanged.

A Chromium probe using the real AnalyserNode and original normalization was compared with the
native PCM16 adapter. Deterministic fixtures contain four harmonics at 300, 600, 900 and 1200 Hz
with amplitudes 1/h, scaled to the stated RMS. They contain no speech and are not recordings of
Sergey. The end of a two-second signal gives:

| Sample rate | RMS | Browser original | Native adapter |
| --- | --- | --- | --- |
| 16000 | 0.03 | 0.3324 | 0.3324 |
| 16000 | 0.10 | 0.4525 | 0.4520 |
| 48000 | 0.03 | 0.4786 | 0.4745 |
| 48000 | 0.10 | 0.6217 | 0.6176 |

Small differences reflect PCM16 quantization and browser frame/window timing. Native tests check
these external reference levels within 0.03, silent output zero, segmentation/stereo equivalence,
sample-rate reset, mute and Stop. The complete input-to-renderer chain reaches level >0.18 within
300 ms and <0.01 after 1.5 s of silence, with no per-frame jump over 0.04. At 66 dp, the 0.03 RMS
fixture produces >1 dp mean radial displacement from silent listening with rotation held constant,
>6 percentage points of radius-scale change, and >3 times the silent ripple amplitude. This
rejects both a no-op and a merely symbolic response without changing the original animation.

Options considered: an RMS gain is smaller but lacks the original frequency/dynamic-range
contract; restoring the missing adapter is the selected local boundary fix; replacing the whole
renderer/session would not address this demonstrated mismatch and adds unjustified scope.

### Before-correction characterization

Synthetic raw RMS input fixtures before the adapter, after two seconds at 60Hz, with listening selected:

| Input RMS | Smoothed level | Ripple amplitude | Radius scale |
| --- | --- | --- | --- |
| 0 | 0 | 0.045 | 1.0101 |
| 0.03 | 0.03 | 0.0522 | 1.0149 |
| 0.10 | 0.10 | 0.0690 | 1.0261 |

These are test signals, not measured levels of Sergey's normal/loud speech. The ordinary versus
loud labels cannot be calibrated before recording the actual scalar input range. Listening has
nonzero ripple and much faster rotation even in silence; its RMS-dependent radial increment at
0.03 is only 0.48% of base radius. Both facts matter: there is a real distinct motion state, but
small RMS changes may be hard to see. Mean corresponding-dot displacements versus idle, thinking
and connecting in the 66dp fixture are 16.62, 15.03 and 26.80dp. These measure geometry, not a
perceptual claim about visually similar particles or a physical-device animation.

Nebula is measured separately: its existing shader changes texture speed/turbulence without
changing the disc radius or palette. RMS 0.01 changes listening turbulence from 1.2 to 1.208.
Production uniform functions are now exposed to native parameter tests without changing formulas.
This does not explain a report about the selected Particles style.

## Reading the device evidence

After a build containing this instrumentation is installed, record only these content-free tags:

```sh
adb logcat -v monotonic -s CodeWideVoiceState:I CodeWideVoiceRender:I '*:S'
```

No speech text, payload, SDP, account identifiers or PCM samples are logged. All event-type output
is reduced to fixed counters; rejected payload strings are never included. State snapshots are
logged at most every five seconds plus admitted semantic/connection events. Renderer snapshots
are logged at most once a second and immediately on its next draw after a phase change.
Instrumentation is restricted to the live service/overlay renderer; no new network sink is added.

`CodeWideVoiceState` shows:

- local peer id and explicit observer attach/close;
- gate, mute, userSpeaking, received start/stop counts, last VAD acceptance or rejection;
- final state passed to the overlay;
- source message/start/stop counts, non-text/unrecognized counts and connection callbacks;
- PCM callback count, sample age, screen-interactive, selected style, reduced-motion;
- separate `inputRms`, `particlesInput` and `playback` scalars.

`CodeWideVoiceRender` shows the **actual renderer** state, advancing draw/animation counts,
renderer input/playback (`rawInput` is now the selected style input, not necessarily RMS),
smoothed/selected level, listening weight, ripple, radius and angle. Nebula
reports its smoothed envelopes and actual speed/turbulence uniforms. It records actual drawn
frames rather than inferring rendering from service publication.

Interpret a silence -> continuous speech -> silence sequence:

1. PCM advances, sourceStarted stays zero: VAD was not admitted at the source. Compare message,
   unrecognized, connection and peer attach counters. Recognition alone cannot choose a new alias.
2. sourceStarted advances but owner speechStarted does not: investigate observer closure/queued
   delivery against the exact peer replacement, before changing the renderer.
3. owner receives VAD with rejected_gate/rejected_muted: fix the demonstrated lifecycle/mute owner.
4. owner publishes listening but renderer does not: trace overlay/slot replacement and phase replay.
5. renderer has listening and advancing frames: inspect actual raw input/level/listeningWeight.
   Zero/weak input, reduced motion and nonadvancing animation are distinct cases.
6. For Particles compare `inputRms` with `particlesInput` and drawn `rawInput`: the latter two
   must match apart from publication timing. VAD remains authoritative; normalized spectrum
   never sets userSpeaking. Check ordinary/loud speech, background/locked screen and barge-in.

Explicit Stop must show observer closure; a later peer attach starts fresh counters. Terminal
states must reject late VAD. Screen off/on must not itself create another peer or clear VAD.

## Validation

Native tests cover recognized VAD -> owner priority -> next phase, PCM/VAD independence, distinct
missing/gate/mute rejection diagnostics, separate content-free source counters, substantial
projected listening differences, input fixtures, and attack/release. Existing background/foreground,
late-event cleanup and renderer tests remain part of the native run. Actual device state and
perceptual salience remain required before this bug can be closed.

The earlier diagnostics-only validation passed 59 native tests, the debug build and Android
bundle; its full V1 gate was blocked by parallel question-UI sorting violations. The microphone adapter correction passed:

- `pnpm validate:android:v1`: formatting, all three TypeScript targets, 255 V1 render tests,
  136 shared render tests, hygiene without regressions, Knip and dependency boundaries.
- `pnpm --filter @codewide/android compile:android`: production bundle and V1 ownership check.
- `sh scripts/android-gradle.sh :app:assembleDebug`: native debug application build.
- `sh scripts/android-gradle.sh :app:testDebugUnitTest --tests 'dev.codewide.app.remote.GlobalVoice*'
  --tests 'dev.codewide.app.rendering.*Orb*' --tests 'dev.codewide.app.rendering.Orb*'`:
  65 tests, no failures/skips. The overlay adapter test records hardware draw commands to exercise
  Nebula's AGSL path; a software Bitmap Canvas cannot render RuntimeShader. It is not a device
  rasterization proof.

Physical Android checklist: observe accepted VAD and final state during recognized speech;
compare silence, ordinary and loud speech in the 66 dp Particles overlay; repeat barge-in during
playback, background/foreground, lock/unlock, mute/unmute, reconnect/peer replacement and Stop.
Check backdrop following separately for both styles, stable tap targets, no stale callbacks,
and actual frame pacing/power cost. ADB reported no connected devices. No APK was installed or
published, and no commit or push was made.
