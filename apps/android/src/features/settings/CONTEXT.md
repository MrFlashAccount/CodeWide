# V1 settings

TypeScript/TSX owns settings visibility and section composition. App-lock authority remains `ui/AppLockGate`; generation selection remains boot-owned. M1 source migration is implemented. Device biometric/generation controls have not been exercised on this host.

Public surfaces: `SubscribedConnectionSettings` and `useSettingsVisibility` in `SettingsFeature`. The workspace retains the hook's existing lifetime. Settings reads the existing account database query and composes public connection settings records, security controls, experiments, diagnostics and version. Connection editors and account login state stay with their feature owners.

`SettingsSheet` retains its selected-server navigation, back behavior, refreshed content and overview fallback when a selected server disappears. Closing/reopening and adding a server preserve the existing callback order. `SettingsVersion` preserves clipboard and version presentation. No settings action disposes or reconstructs the application runtime.

Allowed imports are connection public capabilities and existing shared data/UI/boot authorities. Private cross-feature imports, V2 runtime/storage, lower-to-feature edges and full RemoteWorkspace contracts are forbidden. The experiment and diagnostics modules stay at their current paths until their approved units migrate.

Verification: `settings-sheet.native.test.tsx`, `app-lock.test.ts`, `v1-settings-feature-contract.test.ts`, native configuration checks, and `pnpm validate:android:v1`.
