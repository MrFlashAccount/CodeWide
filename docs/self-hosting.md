# Self-hosting CodeWide

How to install the Companion on your machine, reach it from your phone, pair
devices and operate the host. For the short version, see the
[README quick start](../README.md#get-started).

## Install the Companion

For an ordinary macOS 26+ desktop, install the native menu-bar app from the
CodeWide Homebrew tap. It owns the LaunchAgent lifecycle, Relay setup, QR
pairing, live device presence, revoke, and signed in-app updates:

```sh
brew tap MrFlashAccount/codewide
brew install --cask codewide
```

the portable Companion bundle and its user-systemd units:

```sh
curl -fsSL https://raw.githubusercontent.com/MrFlashAccount/CodeWide/main/install/companion | sh
```

On Linux, the Homebrew package is also named CodeWide:

```sh
brew install --formula MrFlashAccount/codewide/codewide
```

The executable and systemd service keep their `codewide-companion` names.
If you installed the old `codewide-companion` formula, migrate it once:

```sh
brew update
brew trust --formula MrFlashAccount/codewide/codewide
brew migrate --formula codewide
```

### Build from source

Build and install the companion as a user service:

```sh
pnpm build:companion
target/release/codewide-companion create-token
apps/companion-linux/deploy/install.sh
codewide-companion pair
```

## Reach the Companion from your phone

The packaged service exposes an HTTP carrier. Put it behind any ordinary
public-CA TLS ingress, Tailscale, ngrok, or another relay. Application traffic
uses a separate TLS 1.3 connection inside the blind WebSocket carrier, so the
relay cannot read it. Tell the CLI which public `wss://` URL belongs in the QR:

```sh
set -lx CODEWIDE_PUBLIC_ENDPOINT wss://host.example/v1/sync
set -lx CODEWIDE_SERVER_NAME 'Home workstation'
set -lx CODEWIDE_SERVER_EMOJI '🏠'
codewide-companion pair
```

Build the standalone Linux Relay release artifact with
`./scripts/build-relay-linux`. After a Relay release is published, install its
verified portable `x86_64` Linux binary with:

```sh
curl -fsSL https://raw.githubusercontent.com/MrFlashAccount/CodeWide/main/install/relay | sh
```

The installer verifies the binary, places it in `~/.local/bin` or `~/bin`
(whichever standard user directory is already in `PATH`), and starts a systemd
user service without `sudo`. It refuses to install outside `PATH`, so a
successful installation always makes `codewide-relay` directly executable. The
service starts with the user's login; an administrator may separately enable
systemd lingering when the Relay must also run before login and after logout.
Existing system services keep their machine-wide installation and therefore
still require administrator access to update. Existing service configuration,
Relay keys, and paired computers are preserved; a failed startup restores the
previous executable and running service. Use `--no-start` only for a manually
managed, binary-only installation.

To move an older machine-wide installation to the rootless user service, run
the official migration once as the user who will own Relay:

```sh
curl -fsSL https://raw.githubusercontent.com/MrFlashAccount/CodeWide/main/install/relay-migrate-user | sh
```

The migration asks for `sudo` once to stop and archive the old system service,
then preserves its identity, port, and paired computers in the user service.
Any pre-existing user state is retained as
`~/.local/state/codewide/relay-before-system-migration`; the old system unit and
binary remain under `/var/lib/codewide-relay/system-to-user-v1` for rollback.
Future installer runs and signed updates use the user service without `sudo`.

To connect a Mac, run:

```sh
codewide-relay pair
```

The terminal automatically shows the public IP and port. Enter that address in
CodeWide's **Advanced → Add Relay**, click **Connect**, compare the four symbols,
and confirm in the Relay terminal. Allow inbound TCP `8780` in the VPS firewall;
the installer does not change host or cloud firewall rules.

The same Relay binary is available from the CodeWide tap:

```sh
brew install --formula MrFlashAccount/codewide/relay
```

The Homebrew formula installs only the executable; use `codewide-relay serve`
for a foreground server, or the curl installer for automatic service setup.
Android and Companion both connect outbound to that Relay address. Plain
WebSocket connections carry opaque inner-TLS bytes, while TLS 1.3 connections
on the same port carry health, pairing, and control. For a Linux Companion,
`codewide-relay invite` creates an address-independent one-time bundle on the
Relay host. On the Companion host, run
`codewide-companion relay pair relay.example:8780` and paste that bundle. The
running Companion applies pairing and `relay disable|enable` immediately through
its private control socket; no restart is required. Setup, canary and rollback are documented in
[docs/relay-rollout.md](relay-rollout.md).

## Pairing and device security

`pair` reads the Companion identity through the private control socket and puts
its SHA-256 SPKI pin in the QR. A current Android build establishes pinned inner
TLS before it sends the one-time pairing token, public device key, or proof. The
initial challenge/session exchange and all later private traffic stay inside it.
The public carrier exposes no authentication or application data routes; it
accepts only the blind `/v1/e2ee-tunnel` plus Build Shelf / update downloads.

Secure transport is mandatory. Pairing payloads and saved profiles without a
Companion identity pin are rejected and must be paired again. There is no
preview switch, legacy transport, automatic trust-on-current-carrier upgrade,
or downgrade path.

Scan the terminal QR from `Add server`, or enter the one-time token manually.
The CLI selects compact Unicode, ANSI, or a private SVG fallback with
`--qr auto`; use `--qr unicode|ansi|svg` to force a renderer.
The QR expires after five minutes and contains a secret: do not paste it into
logs or share a screenshot. Remote endpoints must use `wss://`; plain `ws://`
is accepted only for loopback, the Android emulator host alias, or an SSH
forward terminating on the device. `serve --insecure-http` is retained only as
a hidden command-line compatibility no-op; it no longer disables or changes
inner TLS.

Build Shelf / OTA and Expo Updates intentionally remain carrier-level public
traffic. They do not pass through the native inner proxy because an app must be
able to download its own update before the application transport is available.

Inspect the public identity without exposing its private key:

```sh
codewide-companion identity
```

The private identity key is stored through the Companion Secure Store. It uses
the platform credential store when available (Keychain, Credential Manager, or
Linux keyring plus Secret Service) and records that backend durably. Headless
systems fall back to a mode-0600 file. A temporarily unavailable platform store
never causes silent key regeneration or a weaker fallback; a later successful
load may migrate the file-backed key upward.

Identity rotation is an explicit recovery event, not silent renewal. Stop the
service, rotate with acknowledgement, restart it, then scan a fresh QR on every
device. The previous private key is deleted and old pins fail closed:

```sh
systemctl --user stop codewide-companion.service
codewide-companion rotate-identity --confirm-device-repair
systemctl --user start codewide-companion.service
codewide-companion pair
```

The phone stores only its revocable per-device capability in Android
Keystore-backed SecureStore; the host persists only its SHA-256 hash and the
installation's public P-256 key. Before every socket reconnect,
the foreground service signs a one-use 60-second challenge with the
non-exportable Android Keystore key, then receives a non-chainable 15-minute
in-memory session token. A stolen bearer without that key cannot mint a session;
a long-lived device capability cannot open `/v1/sync`; and a paired device can
never open the raw `/v1/app-server` bridge. Every successfully authenticated
paired session receives the complete Companion data-plane grant.

The companion exposes registration and session minting through the single
public `/v1/auth` endpoint. Registration signs the one-time pairing token and
device metadata with the non-exportable Android Keystore key. The server derives
`deviceId` from that public key; the id is an identifier, not a secret or a
second factor. Copying either the id or the long-lived capability is insufficient
to mint a session without the private key. Pairing creation, device management,
health checks and the raw App Server bridge exist only on the OS-local control
endpoint and are not routed by the public server at all.

Inspect and revoke devices:

```sh
codewide-companion devices
codewide-companion revoke DEVICE_ID
```

## Host boundary

The production companion binds its blind HTTP carrier to `127.0.0.1:8766` and a
process-private TLS 1.3 listener to a random loopback port. Operator commands
such as pairing and device management use
the same CLI over a private local IPC endpoint (`$XDG_RUNTIME_DIR/codewide/companion-control.sock`
on Linux), protected by directory mode `0700`, endpoint mode `0600` and the
administrator capability. There is no administrative TCP listener to forward by
mistake. A reverse proxy, SSH forward, overlay, or relay sees only opaque inner
TLS records after the WebSocket tunnel is established.

The installed companion binary is also the headless operator CLI: `create-token`,
`pair`, `devices` and `revoke` call the running process through that
local endpoint.

A durable deployment runs `codewide-companion.service` behind an operator-owned
blind relay or private overlay network. Hostnames, tunnel credentials and
provider-specific configuration are machine-local and must not be committed.

## File roots and transfer

The Android system picker uploads composer attachments into the companion-owned
private `attachments` root. Named roots provide stable bases for relative paths;
authenticated paired sessions may also read or write explicit absolute host paths:

```sh
set -lx CODEWIDE_FILE_ROOTS '{"project":"/absolute/path/to/project"}'
systemctl --user restart codewide-companion.service
```

Uploads require `X-Content-SHA256` and use bounded resumable chunks. Downloads resume through byte ranges;
both directions verify the final SHA-256 before publishing the destination.

## Interactive terminal

The Android thread menu can open a full-screen terminal workspace rooted at
that thread's working directory. Each Codex thread owns its own terminal tabs;
there is no global terminal. The companion owns every pseudo-terminal and sends
ordered binary input/output over a dedicated authenticated WebSocket at
`/v1/terminals`; Android owns the certificate-pinned socket, while
`expo-libghostty` provides VT parsing, rendering, selection, IME input and the
terminal accessory keyboard. The down-arrow minimizes the full-screen workspace
without stopping its shells. A `Terminals · N` chip beside the thread resources
restores it; only closing an individual tab terminates that shell. Android keeps
the ordered ANSI transcript in its cache so a recreated renderer can recover
after minimization without keeping hidden terminal views mounted. Transcripts
are deleted with their tabs and bounded to 128 MiB each. A connection shutdown,
thread deletion, or companion shutdown also closes the associated terminals.
The client and companion each permit at most eight concurrent sessions.

Remote shell access is part of the full grant issued to every authenticated
paired session. Revoke the device to remove that access.

The current `expo-libghostty` React Native seam carries base64 strings across
the JS/native boundary. That encoding is confined to the renderer adapter; the
phone-to-companion transport remains binary, so replacing the seam later does
not change the terminal protocol. The native dependency ships 64-bit Android
artifacts only, so Android builds target `arm64-v8a` devices and `x86_64`
emulators rather than advertising a 32-bit terminal that cannot load.

## Phone-local port forwarding

The Android foreground service can expose a remote-machine loopback service as
`127.0.0.1:<phone-port>` on the phone. Each current forward maps one remote
`127.0.0.1:<remote-port>` to an automatically selected or explicitly preferred
phone port. Current forwards survive JS runtime recreation, but are never
restored from saved profiles. The native service polls current listeners while
the connection is enabled and reconstructs forwards from discovery after restart.
Only explicit include/exclude policies persist; React renders the native projection.

The companion lazily inventories listeners when the selected server is active.
It applies the same conservative recognition policy as Doma for Docker Compose,
Minikube, Kubernetes port-forwards, Hermes, Vite, Bun/Node, Python, zrok,
user processes and system-owned services. Stable service keys preserve an
include/exclude choice across ephemeral port changes. Known developer services
start automatically; system services and unknown ephemeral listeners stay in
`Available` until explicitly included. The Ports screen groups recognized
services, filters by name/category/port, and separates `Active`, `Available`
and `Excluded` entries.

A confirmed-live service opens as a full-screen app route, not inside the Ports
sheet. Its browser can dock the bundled Chromium DevTools Frontend below the
page and connects it to the inspected WebView through the real Chrome DevTools
Protocol. Elements, Console, Sources, Network, Application and the Performance
panel therefore use WebView's native CDP implementation rather than an injected
JavaScript console. A separate Android WebView trace control records all native
tracing categories as a fallback. Browser-shell features that Android WebView
does not implement remain unavailable; this is the maximum page-level surface,
not an emulation of desktop Chrome.

Each accepted phone TCP connection gets one authenticated binary WebSocket at
`/v1/port-forwards/<remote-port>`. The companion opens only its own
`127.0.0.1:<remote-port>` and forwards opaque bytes, so HTTP keep-alive,
WebSocket upgrades and dev-server HMR work without protocol rewriting. The
endpoint requires a short-lived authenticated paired session, rejects
browser-origin upgrades, expires streams with their session, and never accepts
an arbitrary target host. The older bounded path-based preview endpoint remains
available for compatibility.

A successful discovery removes a vanished service and closes its phone listener
and active streams. An explicit exclusion remains a policy, not a stale row;
it applies again if the service returns. Failed scans do not masquerade as an
empty inventory. There is no `Saved ports` group. Confirmed-live HTTP services
open in CodeWide's built-in browser, including its bundled developer tools.

The phone listener is loopback-only, but another local app that discovers its
port could connect to it. Prefer automatic high ports and stop profiles that are
not in use; do not forward an unauthenticated administrative service.

Pairings created before device-proof support or before the Companion identity
pin became mandatory must be paired again.

## Server-side voice transcription

The composer records mono PCM16 at Android's native routed sample rate. Native
callbacks use roughly 100 ms capture frames, but those frames are not network
requests: the client coalesces them into ordered one-second batches and keeps
exactly one `companion/dictation/appendBatch` RPC in flight. Stop flushes the
partial batch before `companion/dictation/finish`, so a long recording cannot
be reordered and a short recording cannot lose its tail.

The companion writes the private PCM stream in capture order, wraps bounded WAV
segments, and calls the ChatGPT transcription endpoint only after Stop. Codex
OAuth stays on the host; microphone audio and credentials are never persisted
by the Android client. Retryable rate limits retain the host-side recording only
until explicit retry/cancel or idle cleanup.

## Streaming telemetry

Android sends bounded structured telemetry batches to its own companion. The
schema contains timestamps, event names, numeric measurements, short tags and
explicit identifiers only; message text, prompts, protocol payloads and raw
state are rejected by both client and server. The companion stores at most
200,000 events for seven days in a separate `telemetry.redb`, deduplicated by
device and event id, so diagnostics cannot enlarge or lock the canonical thread
index.

Telemetry ingestion is session-authorized on the public endpoint. Reading it is
available only through the OS-local administrator control endpoint:

```sh
codewide-companion telemetry query --session-id THREAD_ID --descending
codewide-companion telemetry query --request-id REQUEST_ID
codewide-companion telemetry query --from-unix-ms 1787240000000 --to-unix-ms 1787240300000 --name stream.react_commit
```

Time filters use the companion receipt time, which remains useful when a phone
clock is skewed. Queries also accept `--device-id`, `--connection-id`,
`--batch-id`, `--client-session-id`, `--event-id`, `--thread-id`, `--turn-id`,
`--item-id`, exact `--tag-name`/`--tag-value` pairs and `--limit`.
