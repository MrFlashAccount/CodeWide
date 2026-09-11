# Android composer editor trial

`react-native-enriched-markdown@1.0.2.patch` extends the native Android input, not the read-only renderer. It remains a local V1 Settings experiment; there is no draft, send, queue, transport, or server binding.

## Behavior

- Paste matches the editor's appearance: context-menu paste already imports plain characters through the Markdown parser; keyboard `commitText` now drops source spans, and AppCompat receive-content requests plain-text conversion. IME composing text is unchanged. Markdown/code ranges still own the editor's formatting; source-app colors, backgrounds and fonts do not.
- Opt-in `editableMentions` keeps the trigger visible (`/Review`, `@Composer discussion`). Editing the label removes its link binding before range adjustment. Android performs the character/grapheme deletion; native mention events reopen suggestions. Ordinary links retain atomic behavior.
- Inline code and fenced blocks are stored as native formatting ranges. Markdown import/export preserves literal code, indentation, language, and embedded backticks. Copying a selection relocates the code metadata with its text.
- Closing inline backticks converts the typed span. Three backticks plus Enter creates an empty code block. Enter, including repeated Enter, grows a fenced block; only inline code exits on Enter at its end. Empty trailing code lines retain an internal anchor so their native spans and caret stay inside the block. The anchor never reaches exported Markdown.
- Inserted code blocks have real paragraphs before and after them. Short taps in the header (except Copy) or bottom inset select the corresponding outside paragraph, creating it if missing (for example after Markdown import). Native input retains ownership of scrolling, long-press selection and keyboard focus. Existing plain text outside the block is never included in its formatting.
- Backspace removes a semantically empty code block, including its invisible caret anchor. Explicit mention, list and code-block insertion commands invoked inside fenced code move to a plain paragraph after it; typing and pasting code remain inside the block.
- Code formatting and editing run in Kotlin. JS does not reparse or reserialize the document on each keystroke. Markdown is read only on explicit Preview.
- Code-block chrome uses the same scrolled Canvas and text-layout coordinates as the native input. Only touch hit-testing converts viewport coordinates back to content coordinates; drawing must not subtract scroll a second time.
- Code-block spacing implements Android's `UpdateLayout` span contract: insertion, removal and range changes invalidate existing line metrics immediately, without waiting for Enter or another text edit.

## Boundaries

- This extension targets Android only. iOS editor behavior is not implemented or verified.
- Suggestions are labelled demo data. Serialized mentions remain Markdown links; there is no application entity adapter or persisted mention identity yet.
- Tables, nested fenced blocks in lists/quotes, syntax highlighting, and general Markdown editor parity are outside this trial.
- Unit tests cover the real Kotlin range/serialization/mention logic and the React adapter. They do not prove physical IME, caret, or visual behavior. No Appium run is part of this change.
- Paste-style regressions execute Android spans and the real input-connection adapter in Robolectric: transparent source color, background and font are dropped without changing Markdown characters, cursor/range arguments, return values or text attributes. Composing spans remain intact. Device-specific keyboard behavior still requires an APK check.
- The patch includes generated Android Fabric props from the updated native specification and the packaged JS/TypeScript entrypoints. Updating Kotlin alone is insufficient.

## Checks

```sh
pnpm --filter @codewide/android typecheck
pnpm --filter @codewide/android lint
pnpm --filter @codewide/android exec jest --config jest.v2.config.cjs --runInBand test/composer-mention-input.native.test.tsx
pnpm exec vitest run apps/android/test/composer-suggestions.test.ts --reporter=dot
sh scripts/android-gradle.sh :app:testDebugUnitTest --tests dev.codewide.app.rendering.ComposerMarkdownEditingTest --console=plain
sh scripts/android-gradle.sh :app:testDebugUnitTest --tests dev.codewide.app.rendering.ComposerCodeBlockSpanTest --console=plain
sh scripts/android-gradle.sh :app:testDebugUnitTest --tests dev.codewide.app.rendering.ComposerPasteStyleTest --console=plain
```

New native code requires an APK; OTA alone cannot install it. No release is performed by adding this patch.
