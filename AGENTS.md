# CodeWide agent instructions

## Releases

Use only the repository-owned one-shot release commands:

- Publish an OTA update: `./scripts/release-ota`
- Build and publish a new APK: `./scripts/release-apk`
- Validate either release path without publishing: append `--dry-run`

Rules:

- Publishing is an external action. Run a non-dry release only after the user explicitly asks to publish or release it.
- Do not manually export signing variables, locate keys, bump Android versions, copy artifacts, or reconstruct the release sequence when the one-shot command is available.
- Do not call `ota:publish:raw`, `scripts/publish-android-ota.ts`, or Gradle `assembleRelease` as the normal release path. They are low-level implementation details reserved for diagnosing the release runner itself.
- The APK command owns `versionName`, `versionCode`, and `runtimeVersion`. Do not update them separately before invoking it.
- Never bypass a failed release gate. Report the exact failed stage and fix the cause, then rerun the same one-shot command.
- Treat the final JSON printed by the command as the release result. Include its update ID or APK version, runtime, hash, and public download URL when reporting completion.
- A successful local build is not a completed release. Completion requires the command's public manifest or artifact verification to pass.
