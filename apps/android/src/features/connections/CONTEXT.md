# V1 connections

TypeScript/TSX owns pairing sessions, profile-edit admission and server presentation. Wire validation, credential storage, startup and reconnect remain in data/native authorities. M1 implementation is present; device scanning and settings smoke have not run on this host.

Public surfaces are `ConnectionSheet`, `connectionSettingsSections` in `ConnectionFeature`, `useConnectionActions`, `useHostUpdateProjection`, the corresponding narrow input contracts, and connection/server presentation exports. Workspace binds existing methods without passing RemoteWorkspace. Settings consumes the public settings-record factory and host-update projection; list/navigation may consume server projection and display types. Private pairing modes, row forms and state hooks are not cross-feature APIs.

`hostUpdateResource` is the process-lifetime owner for authenticated `/v1/host-update` status, check, apply, operation and reconnect calls. It retains one client idempotency key and exact signed target fingerprint through the expected Companion disconnect, retries a lost `202` with the same intent, and reconciles the durable operation after the same device reconnects. A legacy authenticated `404` is the unsupported/manual path, not a connection failure. Settings never imports its transport, session authority or private model; it renders only the public per-connection projection and emits check/apply intents. Pending UI keeps the current version text and shimmers it.

One mounted pairing session retains form contents through close and resets on the next open identity. Its save checks local readiness before consuming pairing, preserves the 650 ms success display, and keeps lower credential validation unchanged. `connectionActions` distinguishes profile-only edits from credential/runtime updates and emits successful-add intent to navigation. The row editor retains unsaved values, failures and diagnostic expansion at the same mounted lifetime.

Local styles follow pairing/editor/status owners. Only explicit account public surfaces are consumed here. No V2 import, lower-to-feature edge, feature-owned runtime/cache, private cross-feature import or root-composition dependency is allowed.

Verification: `host-update-resource.test.ts`, `v1-host-update-settings.render.test.tsx`, `v1-pairing-session.render.test.tsx`, `v1-settings-feature-contract.test.ts`, pairing/connection semantic tests, native configuration and transport-security contracts, and `pnpm validate:android:v1`. Camera scanning requires a device; no device was attached in the M1 check.

M7 capability closure: `workspaceCapabilities.ts` exposes only this owner's qualified operations. Private `workspaceAdapter.ts` binds existing lower model/session authority through exact workspace composition; it does not own shared in-flight maps, runtime construction or global cleanup. The broad RemoteWorkspace facade is deleted.
