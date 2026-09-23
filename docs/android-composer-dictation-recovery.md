# Composer dictation recovery

This change covers ordinary input-field dictation, owned by `VoiceInputController` and the
composer delivery actions. It does not change Global Voice transport or the separate hands-free work.

## Evidence and limits

On 2026-09-23 the user reported intermittent microphone startup failure and a stuck Send button.
Device telemetry received by Companion showed successful start and audio-batch acknowledgements
for recordings starting at 10:38:33 and 10:50:14 MSK, followed by cancellation without a finish
request. A later recording finished successfully at 10:55:24, with a 4.77-second finish RPC.
These events do not identify the source of cancellation or prove the exact device failure.
No Android device was connected through ADB during this investigation.

Two independent failure paths were reproduced in tests:

- A rejected microphone handoff escaped `toggle()` after publishing `starting`. The controller
  retained an active binding and the input stayed in the startup presentation. Acquisition now
  follows the controller's failure cleanup, reports an error and returns to idle. A cancelled
  acquisition cannot overwrite another input's replacement recording when it settles late.
- Composer wrapped dictation finalization in the message-send lock. Discard used the same lock,
  so it was ignored while finalization was pending. Voice operations now use the recording
  controller's admission state. Discard can abort finalization; pending remote cancellation does
  not block a new message. Settlement of the old voice operation cannot release a newer send lock.

## Boundary decision

The incremental fix handles acquisition rejection in its existing recording owner. The structural
fix removes duplicate voice admission from the message-send lock. Replacing capture/transport
ownership entirely could simplify cancellation but has no evidence-backed advantage for this
incident; it would require a much wider native regression surface. No new timeout, audio truncation,
or transport retry limit is introduced.

## Regression coverage

- Rejected handoff returns idle; a subsequent recording sends its transcript once.
- An old cancelled acquisition failure cannot alter the next recording.
- Pending finalization can be discarded; another message sends while old cancellation is pending.
- Old finish/cancel completion cannot unblock a newer pending message submission.

Existing controller tests cover late transcripts, retry cancellation, audio-tail flushing and
cross-input ownership. Device acceptance still needs microphone start, Finish + Send, explicit
swipe-to-discard during a network interruption, repeat recording, and an assistant-to-dictation
handoff. The exact reported handset failure remains unconfirmed until that reproduction or native
logs are available.
