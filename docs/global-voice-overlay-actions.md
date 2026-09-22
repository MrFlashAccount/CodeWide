# Global Voice overlay actions

## Interaction contract

The menu uses the emergence/retraction pattern of [Gooey](https://libraries.dev/gooey) with native Android windows. Orb rendering, contrast and listening/thinking/speaking presentation have separate owners.

- The first orb tap opens **Mic, Stop, Open app, Settings, Assistant chat**. The second reverses the same timeline and closes it; reopening works after disposal. A repeated state publication does not restart opening.
- Five 48dp hit targets share an 88dp radius and 45-degree angular intervals around the orb center. Placement rotates the whole semicircle and, when a corner leaves too little room, temporarily translates the orb and all actions together into safe bounds. It never clamps individual buttons, changes their radii, or substitutes a corner cluster/line. At least 8dp separates the hit rectangles. All targets and bounded animation overshoot fit the safe area; an impossibly small area (including a keyboard remainder shorter than the complete rigid fan) does not publish clipped targets.
- Opening takes 360ms (240ms motion with 30ms staggering), closing 180ms, drag dismissal 100ms. Reduced motion settles immediately. Buttons accept activation only after opening settles; a gesture begun earlier remains ineligible.
- Closing restores the pre-menu orb position without persisting the temporary offset. A deliberate orb drag takes ownership of the new position; rotation remaps the saved normalized intent and fits the complete menu once in the new bounds.
- Mic stays open and shows the acknowledged capture state. The muted orb is gray. Mic/mic-off, Stop, Open app, Settings and Assistant chat use the existing bundled Ionicons font and glyph map, including `mic-outline`, `mic-off-outline`, `open-outline` `settings-outline` and `chatbubble-ellipses-outline`.
- Stop ends the activation and releases capture, playback, native audio routing and foreground/microphone leases. Open app brings CodeWide forward. Settings opens `/settings?section=voice-assistant` with a fresh request nonce, including when settings is already mounted.
- Outside taps dismiss and remain owned by the underlying application. Gaps have no input window. Orb and sibling-action outside notifications do not dismiss the menu. Drag closes it and never activates Stop. Forwarded orb gestures retain cancellation.

## Assistant chat inspection

The fifth action opens the ordinary conversation screen for the current supervisor's exact `(connectionId, threadId)`. The feature publishes that destination to the service; reconnect/replacement updates it, and stopping or an incomplete home disables the action. Android builds a package-scoped deep link with separately encoded path segments. No activation, microphone or Stop command is dispatched.

This is explicit access to the real stored chat, not a reconstruction from the live transcript and not a new history authority. Companion's ordinary catalog/search filtering stays unchanged. The standard conversation surface reads the requested thread directly, including when it has no list row; detail metadata supplies its title. Navigation and Back do not own voice activation. The shortcut is in the orb menu, following the user's preferred placement, rather than duplicated under Advanced.

Native tests cover five final-coordinate taps, current-home replacement, unavailable-home gating and escaped route identities without Mic/Stop calls. The Router test resolves that encoded destination through the existing thread route. Opening history does not itself repair fragmented/interleaved realtime transcript assembly; that requires inspecting the actual messages and their source separately.

## Proven hit-test mechanism

The previous outside handler compared screen touch coordinates with **requested** WindowManager positions. A window can already have a different applied frame after Android placement/inset handling. It then classified a real action press as outside and removed the action before its click. For the orb, the same sequence closed the menu on DOWN and reopened it on UP.

Hit tests now use the attached views' actual screen locations and sizes. Controller regressions deliver taps at the final applied coordinates, including an applied-frame displacement and sibling outside notifications. Restoring the old hit tests makes the action and second-orb-tap regressions fail. This establishes the failure mechanism in a native test; handset reproduction remains a separate requirement.

Native Mic/Stop events also carry the active foreground lease token. The JS binding ignores stale callbacks from an expired activation. Audio behavior and routing are specified in [global-voice-audio-input.md](global-voice-audio-input.md).

## Follow-up: shared Mic/Stop dispatch failure

The repeated device report remains a failed acceptance result. Correct window coordinates alone did not establish that either command reached the voice session.

Both native callbacks call `GlobalVoiceForegroundModule.emitOverlayEvent`, which resolves its foreground owner through `getNativeModule(GlobalVoiceForegroundModule::class.java)` before emitting the lease-qualified event. The module was registered by name in `CodeWidePackage` but lacked `@ReactModule`. In the installed React Native 0.86.2, `ReactInstance.getNativeModule(Class)` returns null without that runtime annotation. Both callbacks therefore returned before emitting, even when the button received a valid click. The annotation now uses the same name constant as `getName()`.

`GlobalVoiceForegroundModuleTest` protects the required class-lookup registration and JS wire name. It failed before this fix. `GlobalVoiceOverlayInteractionTest` now selects the topmost window containing the actual final animated screen coordinate before delivering DOWN/UP; it also exercises sibling OUTSIDE delivery and displaced applied frames. This prevents its test helper from sending directly through an overlapping window. It still models window selection in Robolectric and does not exercise Android InputDispatcher on a handset.

Follow-up validation: `pnpm validate:android:v1` and `pnpm --filter @codewide/android compile:android` passed. The registration, controller interaction, controls and geometry native suites passed after the fix; the JS overlay dispatch suite passed. No device was connected through adb. Closing the device blocker still requires a new native APK and live Mic mute/unmute plus Stop teardown checks; an OTA cannot change this Kotlin registration.

The rigid-arc follow-up passed 24 focused native tests across registration, final-coordinate dispatch, close/reopen, corner translation/return, deliberate drag, rotation, geometry and muted rendering. Another 26 focused JS tests passed for overlay events, WebRTC mute/Stop, media ownership and sender acknowledgement. Android V1 validation and Android bundle verification passed again. This is source evidence only; device acceptance is still open.

## Rotation and insets

Saved free/snap intent is normalized to safe bounds. Legacy absolute coordinates migrate once; configuration-induced clamps are never persisted as new intent.

The old pipeline mixed full WindowMetrics with inset callbacks from the small overlay window, then destroyed/reopened the menu during reflow. Those callbacks can carry local or stale insets. They are now signals only: a coalesced frame callback reads one complete display metrics/insets snapshot, waits for the same snapshot on two frames and commits each distinct snapshot once. Bars, gestures, cutouts and visible IME contribute to safe bounds.

Configuration changes cancel the previous spring without restoring its stale absolute coordinates. Stable layout remaps the original normalized intent directly, restores the tight orb window and updates the existing fan geometry without replaying opening. If the fan is open, its temporary whole-group translation is computed before moving the orb; closing restores the remapped user intent. Repeated callbacks with the same complete layout neither move the orb nor restart animation. An interrupted hide completes removal instead of leaving a canceled hide lease pending.

## Ownership and validation

`VoiceOverlayControls` owns intent/timeline; `VoiceOverlayActionWindow` owns one pointer stream; geometry, motion, safe bounds, layout settling and icon rendering have separate owners. `GlobalVoiceOverlayController` composes them with the existing orb/session callbacks. Five independent windows preserve touch-through gaps; a second React runtime or a large transparent input panel is unnecessary.

Native regressions cover all five final-coordinate taps exactly once, close/reopen, drag/cancel, muted rendering, safe geometry and portrait-to-landscape remapping with repeated inset callbacks under gesture-sized and three-button-sized bottom insets. JS tests cover lease-fenced dispatch, mute races, sender frames and activation cleanup. Render tests cover Voice Assistant deep-link entry and saved versus actually routed input.

Required source checks: `pnpm validate:android:v1`, `pnpm --filter @codewide/android compile:android`, and focused native unit suites. Source checks do not prove physical routing.

Device acceptance remains pending: gesture navigation and three-button navigation rotation; all five actions and gap/outside touch routing; mute/speech/unmute in a live session; Stop resource teardown; built-in, wired/USB and Bluetooth input, disconnect fallback and route restoration. No device was available through adb during source validation. Nothing is published by these changes.
