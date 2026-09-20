# Global Voice Nebula overlay

## Decision

V1 uses one shared Android renderer slot in the thread-list control and in a draggable system overlay owned by the existing microphone foreground service. Nebula remains the default `RuntimeShader` strategy based on the Reacticx Nebula Orb. The independently persisted Particles option is a native Canvas port of VoiceOrbs and can replace Nebula live without replacing the slot; the old renderer clock is cancelled before the new renderer is attached. Validated local WebRTC `media-source.audioLevel` samples drive listening; speaking uses the upstream procedural fallback until playback energy is available.

## Options and falsification

| Lane | Candidate | Verdict | Falsification |
| --- | --- | --- | --- |
| Incremental | Copy the Reacticx React Native/Skia component into the header | FAIL | It disappears when the activity is backgrounded and therefore does not satisfy the companion contract. |
| Structural | Reuse the exact shader in one native view for both React and `TYPE_APPLICATION_OVERLAY` | PASS for V1 | It preserves one visual implementation, survives app backgrounding and adds only the Android overlay permission boundary. |
| Radical | Run a second React surface inside the foreground service | FAIL for V1 | It duplicates React lifecycle, navigation and crash ownership for no demonstrated product gain. Reversibility is poor; the cheapest validating experiment was the native shader view, which already satisfies the required visual and lifetime behavior. |

The structural option is reversible: removing the overlay permission, controller and manager returns to the header-only control without changing the Global Supervisor protocol, thread ownership or settings model.

## Contracts

- Reacticx remains the Nebula source and VoiceOrbs remains the Particles motion source; CodeWide owns Android window lifetime, renderer selection and audio reaction.
- Both strategies accept `idle | connecting | listening | thinking | speaking | error | disabled`; the supervisor phase adapter is exhaustive and `stopping` remains disabled until cleanup publishes `ready`.
- The overlay token exists only for interactive Global Voice. V2 dictation continues to share the foreground service but never creates this window.
- System-overlay permission is separate from microphone permission. The app opens Android's app-specific grant screen before the first activation and never attempts to bypass denial.
- Audio visualization polls the already-owned WebRTC sender at 10 Hz. External stats are accepted only as a `Map` containing finite `media-source.audioLevel` values in `[0, 1]`.
- Stats failure is visual-only: it yields no new media failure, content log or supervisor state.
- The native renderer smooths low-rate samples at display cadence. The React tree does not re-render for microphone energy.
- Dragging follows the pointer through bounded overscroll around system-bar and cutout-safe bounds. Release inside a narrow edge zone continues the measured gesture velocity into a critically damped snap, release outside safe bounds springs back, and release elsewhere remains free.
- Free positions persist as normalized coordinates. Edge attachment persists as side plus normalized vertical position, so rotation, display-size and inset changes restore an accessible placement instead of replaying stale pixels.
- Tap is separated from drag by Android touch slop and opens circular native icon controls without mounting another React surface. Stop routes to the single Global Voice feature action; More exposes the app-open action.

## Validation record

Automated validation covers:

- exact foreground token isolation between dictation and Global Voice;
- overlay permission routing and manifest/package registration;
- malformed, non-finite and out-of-range WebRTC stats;
- level delivery and reset on WebRTC stop;
- attack/release envelope behavior;
- deterministic VoiceOrbs sphere/ring geometry, seven-state blending, ripple/pulse/flow motion and wire parsing;
- free placement, spring return, velocity-preserving snap, touch-slop tap/drag separation and normalized restore under changed bounds;
- native overlay Stop routing to the existing feature lifecycle owner;
- the existing header start/stop and duplicate-suppression contract;
- the full `pnpm validate:android:v1` gate.

Physical-device validation remains required for both renderers on light and dark backgrounds, Particles frame pacing at the selected 192-point overlay density, the header-to-overlay launch handoff, overlay grant/revocation, free drag and animated edge settling/return, rotation/inset changes, icon controls, background persistence, microphone response, explicit stop, and representative OEM background restrictions. Publishing is a separate action.
