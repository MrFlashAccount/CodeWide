# V1 review

Public surfaces: ReviewFeature binds the mounted review session; CodeReviewWorkspace presents file review; ReviewTargetSheet chooses the existing review command; reviewSubmission prepares text attachments; code-review-files converts received change resources. Resource loading, line comments, voice binding and view settings have private owners.

Source publishes before diff completion. Abort checks guard publication and final materialization; existing async-resource keys and revision identities remain authoritative. A retained voice binding writes to its captured line after selection changes. Composer owns draft attachment admission and identity-checked acknowledgement through its reviewAdmission capability. The existing shared ContentReviewHost owns cross-renderer selection and session lifetime.

M4 review: V1 gate passed (2189 modules, 7677 dependencies), 83 focused semantic/source/boundary checks and two render checks passed. Tests preserve delayed line transcript, selected-line isolation and acknowledgement of only the sent attachment. Actual Android voice/WebView interaction remains unverified under the resolved device disclosure.

M7 capability closure: `workspaceCapabilities.ts` exposes only this owner's qualified operations. Private `workspaceAdapter.ts` binds existing lower model/session authority through exact workspace composition; it does not own shared in-flight maps, runtime construction or global cleanup. The broad RemoteWorkspace facade is deleted.
