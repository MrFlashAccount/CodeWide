# Rust companion migration-delta audit

Date: 2026-08-17

## Scope

The audit compared every uncommitted change in `apps/host-companion` and
`packages/sync-client` made after the repository baseline used for the Rust
rewrite. It also rechecked production-only host configuration that is not part
of the authenticated V1 RPC list but would be affected by a port cutover.

## Result

| Change in the active Node/client implementation | Rust status | Regression evidence |
| --- | --- | --- |
| `account/rateLimits/read` is a `threads.read` RPC | Already present; wire forwarding now covered explicitly | `v1_contract.rs`, `sync_transport.rs` |
| `CODEWIDE_PREVIEW_PATH_MAPPINGS` reads exact app-server-observed files through a separate `PrivateTmp` bind mount | Ported | `files_transport.rs` proves the observed file is readable and its sibling remains `403` |
| Build shelf/OTA proxy for `/api/updates`, update assets, APK and download paths | Missing cutover dependency; ported as a restricted loopback-only module | shared frozen path list plus Node and Rust transport tests |
| Extra history benchmark turn IDs | Diagnostic only; no runtime behavior to port | excluded deliberately |
| Canonical initial thread window and live event semantics | Ported: `thread/resume` returns one authoritative window; replay events carry bounded `codewideThreadPatch.v1` metadata | `thread_view.rs`, `thread_patch.rs`, frozen V1 contract, Android projection tests |
| Turn/session usage and API-equivalent cost | Owned by the Rust companion: live state is persisted in redb and completed turns are reconstructed from canonical rollout `token_count` records. The UI receives `codewide.usage` and performs no attribution or pricing. | `usage.rs`, `history.rs`, `thread-events.test.ts` |

No other Node companion runtime delta was present in the working-tree diff.

## Guardrail

The public build-shelf path list now lives in the frozen V1 contract. Node and
Rust both consume equivalent constants and both contract suites compare their
surface to that file. Preview mapping, rate-limit RPC forwarding and OTA header
forwarding have behavior-level tests on both implementations.

The same contract now freezes every semantic live-thread operation. Rust and
Node preserve the raw notification for old APKs, attach only constant-size
operation metadata, and never duplicate a large turn, item, diff, or delta in
the WebSocket frame. Android consumes the semantic patch and keeps raw event
decoding only as an isolated rollback adapter.

Any future Node companion contract change must update the frozen contract or add
a cross-implementation behavior test before Rust can pass the migration gate.

## Cutover impact

The Rust shadow unit now carries the same local build-shelf origin as production
Node: `http://127.0.0.1:4190`. The proxy accepts only HTTP loopback origins,
forwards only the explicit public path allowlist, strips credentials by copying
only Expo/range negotiation headers, rejects redirects, and times out after 15
seconds.

Production FRP now routes to Rust `127.0.0.1:8766`. Node remains healthy on `8765`
for immediate rollback.

## Live verification

- Production Rust is healthy and authenticated on `127.0.0.1:8766` with mutations enabled.
- The production Node process remained unchanged across the Rust install.
- The same valid Expo OTA request through Node and Rust returned `200`, identical
  headers of interest, identical 16,435-byte bodies and the same SHA-256
  `98fd231343364d14e29b15f6e84ac387b98d424b9f17354eede3e6b7b4b89dab`.
- Completed 110 KB and 100 MB real threads still match semantically, including
  two history pages and all 182 projected resources on the larger thread.
- The deployment's public WSS route passed mutation smoke for start, rename,
  goal, turn, read, fork, archive/unarchive and delete.
- Public OTA returned Expo protocol `1`; APK range requests returned `206`.
- The installed production Node binary predates the uncommitted
  `account/rateLimits/read` source change and was deliberately not refreshed.
  Rust carries the new method and its wire regression test; this is exactly the
  kind of in-flight source delta this audit was meant to catch.
