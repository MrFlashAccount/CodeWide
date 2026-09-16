# V1 review

Public surfaces: ReviewFeature binds the mounted review session; workspace/CodeReviewWorkspace presents file review; ReviewTargetSheet chooses the existing review command; comments/reviewSubmission prepares text attachments; resources/reviewFiles converts received change resources. Resource loading, line comments, voice binding and view settings have private owners.

The feature owns the complete code review editor. `editor/` contains the native and web adapters, typed bridge and display policy. `editor/webview/` is the browser-only Pierre application and its authored HTML template; `sync-code-review-editor-asset.mjs` bundles that entry into Android assets. The browser entry uses a `.web.ts` suffix so the web TypeScript graph checks its DOM contract while the native graph excludes it. Generated Android assets are outputs, not source owners.

Source publishes before diff completion. Abort checks guard publication and final materialization; existing async-resource keys and revision identities remain authoritative. A retained voice binding writes to its captured line after selection changes. Composer owns draft attachment admission and identity-checked acknowledgement through its reviewAdmission capability. The shared `rendering/ContentReviewHost` remains outside this feature because Markdown, image, diagram and attachment renderers use its cross-renderer selection and session lifetime. The feature does not own those generic annotation primitives.

M4 review: V1 gate passed (2189 modules, 7677 dependencies), 83 focused semantic/source/boundary checks and two render checks passed. Tests preserve delayed line transcript, selected-line isolation and acknowledgement of only the sent attachment. Actual Android voice/WebView interaction remains unverified under the resolved device disclosure.

M7 capability closure: `workspaceCapabilities.ts` exposes only this owner's qualified operations. Private `workspaceAdapter.ts` binds existing lower model/session authority through exact workspace composition; it does not own shared in-flight maps, runtime construction or global cleanup. The broad RemoteWorkspace facade is deleted.
