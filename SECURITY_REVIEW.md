# V1 security review

Review date: 2026-08-10. Scope: Android client, host companion, sync protocol,
file transfer, localhost tunnel and generated artifacts.

## Threat model

The V1 trust boundary is one user, one or more private Codex hosts and paired
Android installations. The Internet, browser pages opened through localhost
preview, unpaired devices, other devices with narrower scopes and thread/tool
content are untrusted. A process already running as the same OS user as Codex
is outside the isolation boundary: it can already access that user's workspace
and Codex state.

## Findings closed in implementation

- The companion binds loopback by default. A non-loopback listener now requires
  explicit opt-in; the supported remote path is a private TLS/SSH proxy.
- The host companion is installed as a restartable user-systemd service with a
  mode-`0700` state directory and mode-`0600` capability/device/replay files. A
  persistent zrok share reaches only its loopback listener and is checked both
  directly and through a private Ziti access path.
- Raw App Server access requires the host admin token. Paired devices can only
  use the allowlisted sync surface and every RPC is mapped to a device scope.
- Pairing secrets expire after five minutes and are one-use. Device capabilities
  are stored hashed on the host; a connection additionally requires a one-use
  ECDSA proof from a non-exportable Android Keystore key. Session tokens expire,
  are memory-only and are invalidated on revoke or scope change.
- Android stores the long-lived capability only in Keystore-backed SecureStore
  and an AES-GCM Keystore mirror used by the foreground service. SQLite stores
  connection metadata, never the capability.
- Canceling or externally closing connection forms clears unsaved pairing and
  replacement capabilities from React state. Automated AVD pairing reads only
  a group/world-inaccessible one-time payload, accepts shell-safe fields and
  never copies pairing or capability tokens into its evidence bundle.
- Remote endpoints require WSS except explicit loopback/emulator development
  aliases. Optional OkHttp certificate pinning covers pairing, session mint,
  sync, file and tunnel control requests.
- File access is restricted to configured canonical roots, rejects traversal
  and symlink escapes, is size-bounded and verifies SHA-256. Non-overwriting
  publication uses an atomic hard link so a racing writer cannot be replaced.
- Composer attachments remain root-relative while queued, then are resolved and
  canonicalized again at dispatch. Inline image previews use a separate scoped,
  authenticated, no-store endpoint, carry a deny-all sandbox CSP and cannot read
  outside configured roots.
- Accepted prompts are bounded before persistence; SQLite applies atomic
  per-connection outbox capacity so no accepted command can sit beyond the
  dispatch window. Explicitly rejected commands can be removed, while uncertain
  delivery cannot be discarded before reconciliation.
- Localhost tunnels target only `127.0.0.1`, expire within a bounded TTL, strip
  hop-by-hop and authorization headers, use scoped HttpOnly browser cookies and
  enforce same-origin WebSocket upgrades.
- Browser `Origin` is rejected on administrative, pairing, sync and file bearer
  endpoints. WebSocket frame, pending RPC, replay, native journal and proxy
  buffers have per-connection and device-wide bounds. The sync hub additionally
  caps pending work globally and refuses outbound/upstream buffer growth.
- Approval responses are atomically claimed and acknowledged to Android only
  after the upstream App Server WebSocket confirms the frame was handed off;
  concurrent duplicate resolution is rejected.
- Android disables backup, public cleartext, broad storage permissions and
  exported access to its foreground service. The Expo development network
  inspector is disabled. Lock-screen notifications omit prompts, commands,
  paths and thread names.
- The vulnerable transitive `uuid` range is overridden to patched 11.1.1.
- The proposed no-Basic-Auth zrok edge is a closed, separately granted zrok
  namespace with its own frontend. A safe share is created in that namespace;
  it is never a hostname alias for a regular share, so changing a regular URL's
  suffix cannot bypass its Basic Auth policy.

## Open release gates

- The loopback service and persistent zrok transport are live, but the separate
  safe zrok namespace/frontend, DNS and wildcard certificate are not deployed
  from this host. The wrapper refuses `--safe` promotion until the public TLS
  probe succeeds. Production WSS and certificate pin rotation still need an
  end-to-end device test.
- Keystore invalidation, reinstall, revoke and session-expiry behavior still
  need runtime evidence on physical Android hardware. Emulator pairing and a
  signed data-preserving v1→v2 upgrade are green.
- The signed release APK is built with a dedicated key and independently passes
  the secret/private-path scanner. CI publication scanning is not wired yet.
- `pnpm audit --prod` currently reports two high denial-of-service advisories in
  Expo/Metro's build-time `image-size` dependency (ICNS and JXL/HEIF parsers).
  The advisory declares no patched release. These parsers are not part of the
  host runtime and build inputs must remain repository-controlled; this remains
  tracked until the upstream toolchain ships a fix.

The security gate therefore remains **PARTIAL**, not PASS.
