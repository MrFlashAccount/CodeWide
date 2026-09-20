# Global Voice runtime resilience

## Scope

This contract covers the V1 Voice Assistant runtime, its Android overlay, network transport and the existing text-input dictation controller. It does not add a setting, a second microphone controller, another supervisor thread or a profile system.

## Root causes

- The overlay release handler always converted every drag into an edge attachment. It had no free-placement state, snap zone, gesture velocity or tap control surface, and persisted absolute pixels without inset-aware restoration.
- WebRTC `failed` and `closed` callbacks entered the same terminal runtime path as explicit Stop. Activation cleanup then released the foreground service and unmounted the overlay, so a VPN route change destroyed the logical Voice Assistant session.
- The shared V1 microphone lease was only first-owner-wins. Global Voice retained it until terminal cleanup, so ordinary input dictation could only report busy; neither consumer had a narrow suspend/resume contract.

## Options and falsification

| Lane | Candidate | Verdict | Falsification |
| --- | --- | --- | --- |
| Incremental | Patch overlay gestures and retry inside individual UI/native callbacks | FAIL alone | It can improve drag/tap, but local retries cannot preserve one activation or serialize microphone and transport ownership. |
| Structural | Keep one logical activation, add one bounded replaceable transport owner, and evolve the existing microphone lease into a handoff arbiter | PASS for V1 | It preserves the supervisor-thread boundary, foreground overlay and existing dictation owner while making every capture transition explicit and testable. |
| Radical | Move the supervisor session and audio arbitration into a new persistent native service or server-resumable media protocol | CONDITIONAL, not V1 | Potential upside is stronger process-death continuity. Risk and migration cost are high, rollback crosses protocol/native boundaries, and no current evidence requires process-death recovery. The cheapest proving experiment is the structural owner under VPN handoff and background/device tests. |

The structural option is selected. It is reversible because the wire contract, durable thread binding, personality settings and dictation protocol remain unchanged; the new owners sit below the existing feature interfaces.

## Runtime contracts

Network transport follows:

`active transport -> reconnecting -> replacement transport | recoverable failure`

A transport terminal is not Stop. Replacement uses one cumulative bounded backoff policy, closes the previous peer/channel before creating another and keeps the activation id, qualified supervisor thread and foreground lease. Explicit Stop cancels waits and prevents any later replacement.

Microphone ownership follows:

`assistant-owned -> handoff-to-dictation -> dictation-owned -> handoff-back -> assistant-owned`

The arbiter grants dictation only after the assistant transport has stopped. Dictation finish, cancel and capture/start errors release the exact token and resume transport. A competing input remains busy. If explicit Stop occurs while dictation owns capture, the arbiter removes the suspended assistant; dictation may finish, but handoff-back becomes idle and cannot recreate Voice Assistant.

Overlay placement is either free or attached to a declared edge snap zone. Drag uses raw pointer deltas after Android touch slop. Free placement is clamped and normalized for persistence; snap animation starts from the released position and velocity. Tap opens native Stop/More controls and never doubles as drag.

Android acoustic echo cancellation has two deliberately separate owners:

- An interactive Global Voice WebRTC session acquires `MODE_IN_COMMUNICATION` before opening its peer and restores the exact previous mode on stop, startup failure or React-context cancellation. Its `JavaAudioDeviceModule` explicitly uses `VOICE_COMMUNICATION`, speech communication output attributes and the ADM hardware AEC/NS policy. Receive-only previews never acquire the mode.
- V1 raw PCM dictation attaches Android `AcousticEchoCanceler` to that recorder's `audioSessionId` when the platform reports support, enables it only while the effect has control and releases it with the recorder on every path. It does not add a software echo canceller.

For the built-in route, Global Voice selects `TYPE_BUILTIN_SPEAKER` because Android otherwise sends communication playback to the earpiece. The selection is scoped to the interactive lease: the previous device is restored on release. If any external communication device is available, CodeWide leaves the system route alone; connecting a wired, USB, Bluetooth or BLE device clears CodeWide's speaker request, and removing it reapplies the built-in-speaker default. AEC can subtract the phone's own playback because Android/WebRTC has its render reference; sound from another phone, television or other external source is ordinary environmental input and is not contractually removed.

V2 capture remains outside this change. It is a separate, one-shot `VOICE_RECOGNITION` lifecycle with no proven full-duplex playback reference. Enabling communication-mode AEC there or extracting a shared lifecycle abstraction would currently be speculative and could degrade recognition.

## Validation contract

Automated checks must cover:

- the VPN on/off route-change regression with one activation, one supervisor thread, a persistent foreground lease and reconnecting state;
- network handoff, repeated flaps, policy exhaustion and Stop during reconnect;
- full assistant-to-dictation-to-assistant handoff, repeated taps, competing inputs, capture/start failure and Stop during handoff;
- no overlapping assistant/dictation capture and no two active realtime transports;
- free overlay placement, animated velocity-preserving snap, tap-to-controls, normalized restore and inset/orientation clamping;
- the complete `pnpm validate:android:v1` gate.

Device validation remains separate evidence. It must repeat the VPN on/off repro, exercise free drag/snap/tap controls, rotate or change insets, dictate into at least the main composer and one secondary text input, and verify Stop during reconnect/handoff. For AEC, play a stable spoken sample through the phone's built-in speaker while capturing interactive Global Voice and V1 dictation, compare it with the same capture before the fix, then repeat with the sample played by a separate external device. Own-speaker leakage should fall substantially; the external source is not expected to disappear. Repeat with wired and Bluetooth headsets and confirm the system route is not overridden. A test-only pass must not be reported as device verification.
