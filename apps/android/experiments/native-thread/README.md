# Android transcript experiment

This directory builds an emulator APK with three ways to display the same real conversation data. The ordinary Android application has no import from this directory. The lab build injects its entry point into the existing timeline and registers the native views in a temporary copy of the app's Kotlin sources.

| Mode | What it exercises |
| --- | --- |
| `stock` (default) | Existing LegendList and existing rows. |
| `mixed-audit` | The same viewport, plus a test ID indicating the actual projected row and block types. |
| `hosted-mixed` | RecyclerView virtualization with the existing React row renderer and footer. Mounted rows retain their semantic React keys. The prototype requests a bounded range and reuses holders. Search, opening at a saved index, response anchors, and a window with a newer page use the stock viewport. If visible rows have not settled within one second of mounting, the lab returns to the stock viewport and exposes the recovery test ID. Scroll commands, bookmark persistence, keyboard lift and pagination are incomplete in the hosted viewport. |
| `reference-paragraph`, `reference-list`, `reference-table` | A diagnostic range selected from the open thread, rendered with LegendList and the application's Markdown renderer. |
| `native-paragraph`, `native-list`, `native-table` | The same range supplied as a single window prop to a RecyclerView. Android creates and binds the visible rows. Eligible inputs are plain paragraphs, grouped completed lists, and plain tables. |

## Reproduce

From the repository root, run `apps/android/experiments/native-thread/build-lab`. It prints the APK location. It needs the project's Android SDK, JDK, Node dependencies, and debug signing configuration. The APK uses the Preview application ID and debug signing. Install it on a disposable x86_64 lab emulator.

On a rooted emulator already paired with the test Companion, select the desired arm with the app stopped. The file belongs to the disposable app's cache.

```sh
device=emulator-5588
package=dev.codexremote.app.preview
mode=hosted-mixed
adb -s "$device" shell am force-stop "$package"
adb -s "$device" shell "su 0 sh -c 'echo $mode > /data/user/0/$package/cache/thread-lab-mode'"
adb -s "$device" shell am start -n "$package/dev.codewide.app.MainActivity"
```

Tap the fixture's catalog row. Confirm the actual arm and nonempty range via an accessibility snapshot. Capture the same scroll position, selection and media state in both arms. For timings, enable app tracing and Android FrameTimeline in Perfetto. Run `measure-present.py --processor TRACE_PROCESSOR TRACE` for the full thread or add `--range` for isolated block runs. A null result indicates missing frame evidence. Timing begins at the physical catalog press and ends at display presentation of a frame containing bubble text. A picture difference, missing content, mismatched anchor, or missing action disqualifies a pair as evidence of an equivalent faster experience.

## Checks before replacing the list

- Compare text, wrapping, vertical offsets, punctuation, code, table cells, image, video and attachment geometry at the same width and font scale. Check the first frame and the settled viewport.
- Verify selection and Review, link activation, media fullscreen and Back, activity menus, search and search-result navigation.
- Reopen halfway through a long response after new messages arrive. Verify the same message and offset. Open at the first unread message. A short unread that fits at the bottom keeps that position.
- Finish a stream at the tail and away from the tail, across the existing dead zone. Page in both directions, rotate, and show and hide the keyboard. Verify the first visible row holds its position.
- Compare first and repeat opens separately. Preserve rejected runs in the report. A range measurement applies only to its selected content.
