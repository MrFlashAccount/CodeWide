# Companion-owned port inventory

Companion owns one port inventory watcher shared by V1 and V2 connections. The
watcher runs OS and process discovery on a dedicated thread. Handshake, chat
projection, RPC and websocket receive handlers never await discovery.

The design follows Doma's remote inventory watcher (commit
`d66e14427d48f399b6fbf51fe5e63da28ea56a6b`): one remote observation loop, an immediate
initial result and five stable one-second samples before publishing a change.
Doma sends an invalidation marker over SSH; CodeWide sends the resulting bounded
inventory over the existing authenticated sync websocket.

## Transport and ownership

- V1 opts in with `portInventory: true` in `hello`. Its `portInventory` server
  frame carries a revision and `{ ports, scannedAt }` inventory.
- V2 opts in with `intent.portInventory: true`. Its closed `portInventory` frame
  also carries the current connection `epochId`; `contract/v2.json` owns the
  schema. The sync-client session validates epoch ownership and publishes a
  separate latest-value resource without waiting for message projection commits.
- A watch channel retains only the newest snapshot. Slow clients coalesce
  intermediate revisions. Reconnection subscribes to the current snapshot;
  port history is not persisted in the message replay journal.
- Clients that do not opt in receive no new frames. Existing HTTP discovery
  endpoints remain available for older clients.

The Android service forwards received inventories to a dedicated coalescing
worker. That worker validates the complete inventory, checks the saved server's
local authority generation and reconciles forwarding policies and listeners.
`automatic`, `included`, and `excluded` policy ownership remains on the phone.
Suspension and authority replacement invalidate queued inventories.

The legacy-named native `discoverPorts` bridge now reads the latest cached
inventory. It does no HTTP or OS discovery. V1 and V2 resources read this cache
initially and refresh it in response to native inventory notifications. Their
periodic discovery timers and the native HTTP inventory monitor are removed.
The initial cache has `scannedAt: 0`, which means that the first pushed inventory
has not arrived yet. An invalid update retains the last accepted inventory and
publishes a bounded error notification.

## Concurrency contract

Discovery cannot acquire the Android service monitor. Neither network callbacks
nor the microphone wait for inventory reconciliation. At most one pending
inventory per saved server is retained by the native worker. Port changes do not
reinitialize chat epochs or contribute messages to the conversation timeline.

OS scanning itself is synchronous on its worker; a slow OS command can delay port
updates, but does not occupy the websocket executor or Android bridge queue.

## Validation and release

Tests cover debounce, latest-value coalescing, epoch rejection, client updates
without timer polling, independent worker delivery, and real listener removal
and reconnect over V2 websocket transport. V1 transport coverage verifies delivery
before chat snapshot acknowledgement and continued ping responses. A blocked OS
scan test proves that subscribing and unrelated async work can still proceed.
Run `pnpm validate:android:v2` and the
V1 port-forwarding tests. Deployment requires updated Companion and APK; OTA
alone cannot replace the native polling implementation.
